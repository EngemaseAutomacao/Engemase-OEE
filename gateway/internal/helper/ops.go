package helper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// System é o que as operações pedem ao sistema operacional. A implementação real
// (system_linux.go) chama o NetworkManager pelo D-Bus (busctl/nmcli), o systemd e o
// relógio; os testes usam uma falsa.
type System interface {
	// CheckpointCreate cria um checkpoint de todos os dispositivos que o
	// NetworkManager desfaz sozinho depois de rollback sem confirmação.
	CheckpointCreate(ctx context.Context, rollback time.Duration) (string, error)
	CheckpointDestroy(ctx context.Context, path string) error
	CheckpointRollback(ctx context.Context, path string) error
	// ReloadConnections relê os keyfiles e ActivateConnection sobe um perfil pelo id.
	ReloadConnections(ctx context.Context) error
	ActivateConnection(ctx context.Context, id string) error
	RestartUnit(ctx context.Context, unit string) error
	StopUnit(ctx context.Context, unit string) error
	StartUnit(ctx context.Context, unit string) error
	NTPSynchronized(ctx context.Context) (bool, error)
	SetClock(t time.Time) error
	// Chown acerta o grupo de um arquivo gerado (ex.: network.json root:oee).
	Chown(path, group string) error
	Hostname() (string, error)
}

// Paths são os arquivos que o ajudante lê e gera (ReadWritePaths= da unit).
type Paths struct {
	NetworkJSON   string // fonte única da rede
	ProxyEnv      string // EnvironmentFile= do agente
	CABundle      string // CAs corporativas do agente
	NMDir         string // keyfiles oee-it/oee-ot
	ChronySources string // NTP do cliente
	StateDir      string // estado do ajudante (checkpoint pendente)
	USBDir        string // OEE/ do pendrive de serviço, montado por outro serviço
	AgentState    string // estado do agente (/var/lib/oee-gateway)
	LocalUIState  string // estado da página local (/var/lib/oee-localui)
}

// DefaultPaths são os caminhos canônicos (docs/16 §4).
func DefaultPaths() Paths {
	return Paths{
		NetworkJSON:   "/etc/oee-gateway/network.json",
		ProxyEnv:      "/etc/oee-gateway/proxy.env",
		CABundle:      "/etc/oee-gateway/ca-bundle.pem",
		NMDir:         "/etc/NetworkManager/system-connections",
		ChronySources: "/etc/chrony/sources.d/egw-ficha-ti.sources",
		StateDir:      "/var/lib/oee-helper",
		USBDir:        "/run/oee-usb/OEE",
		AgentState:    "/var/lib/oee-gateway",
		LocalUIState:  "/var/lib/oee-localui",
	}
}

// ConfirmTimeout: sem network.confirm nesse prazo, o NetworkManager volta a rede
// anterior sozinho (docs/16 §5).
const ConfirmTimeout = 120 * time.Second

// Ops executa as operações fechadas, uma de cada vez.
type Ops struct {
	Sys   System
	Paths Paths
	Now   func() time.Time
	// AgentGroup é o grupo dos arquivos que o agente lê (network.json, proxy.env).
	AgentGroup string

	mu sync.Mutex
}

// opError é uma falha com código para a resposta.
type opError struct {
	code, msg string
}

func (e *opError) Error() string { return e.msg }

func opErr(code, format string, a ...any) error {
	return &opError{code: code, msg: fmt.Sprintf(format, a...)}
}

func (o *Ops) now() time.Time {
	if o.Now != nil {
		return o.Now()
	}
	return time.Now()
}

// pending é a mudança de rede à espera de confirmação (StateDir/pending.json).
type pending struct {
	Checkpoint string        `json:"checkpoint"`
	Deadline   time.Time     `json:"deadline"`
	Version    int           `json:"network_version"`
	Backup     []backupEntry `json:"backup"`
}

// backupEntry é um arquivo gerado como estava antes da mudança.
type backupEntry struct {
	Path   string      `json:"path"`
	Exists bool        `json:"exists"`
	Data   []byte      `json:"data,omitempty"`
	Mode   fs.FileMode `json:"mode,omitempty"`
	Group  string      `json:"group,omitempty"`
}

func (o *Ops) pendingPath() string { return filepath.Join(o.Paths.StateDir, "pending.json") }

func (o *Ops) loadPending() (*pending, error) {
	b, err := os.ReadFile(o.pendingPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p pending
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, fmt.Errorf("pending.json ilegível: %w", err)
	}
	return &p, nil
}

// PendingDeadline é o prazo da mudança de rede pendente (zero se não houver).
func (o *Ops) PendingDeadline() time.Time {
	o.mu.Lock()
	defer o.mu.Unlock()
	p, err := o.loadPending()
	if err != nil || p == nil {
		return time.Time{}
	}
	return p.Deadline
}

// reconcileGrace: depois do prazo, espera o NetworkManager terminar a volta.
const reconcileGrace = 5 * time.Second

// Reconcile trata a mudança pendente cujo prazo passou: o NetworkManager já voltou
// a rede sozinho, então os arquivos gerados (network.json, proxy.env, ...) voltam
// também. Roda no início do ajudante e no prazo. Devolve true se desfez algo.
func (o *Ops) Reconcile(ctx context.Context) (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	p, err := o.loadPending()
	if err != nil || p == nil {
		return false, err
	}
	if o.now().Before(p.Deadline.Add(reconcileGrace)) {
		return false, nil
	}
	// Se o checkpoint ainda existir (ex.: NetworkManager reiniciado), volta agora;
	// se não existir mais, o erro só confirma que ele já voltou.
	_ = o.Sys.CheckpointRollback(ctx, p.Checkpoint)
	return true, o.restore(p)
}

// restore devolve os arquivos do backup e apaga o pendente.
func (o *Ops) restore(p *pending) error {
	var errs []error
	for _, b := range p.Backup {
		if !b.Exists {
			if err := os.Remove(b.Path); err != nil && !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
			continue
		}
		if err := o.write(b.Path, b.Data, b.Mode, b.Group); err != nil {
			errs = append(errs, err)
		}
	}
	if err := errors.Join(errs...); err != nil {
		return err
	}
	return os.Remove(o.pendingPath())
}

// currentNetwork lê o network.json atual (gravado pelo factory init).
func (o *Ops) currentNetwork() (*Network, error) {
	b, err := os.ReadFile(o.Paths.NetworkJSON)
	if err != nil {
		return nil, opErr(ErrFailed, "network.json atual ilegível: %v", err)
	}
	n, err := ParseNetwork(b)
	if err != nil {
		return nil, opErr(ErrFailed, "network.json atual: %v", err)
	}
	if n.IT.MAC == "" || n.OT.MAC == "" {
		return nil, opErr(ErrFailed, "network.json atual sem os MACs da unidade")
	}
	return n, nil
}

// NetworkApplyParams são os parâmetros de network.apply: a rede nova inteira ou o
// perfil de fábrica.
type NetworkApplyParams struct {
	Network *Network `json:"network,omitempty"`
	Profile string   `json:"profile,omitempty"` // factory
}

// NetworkApply aplica a rede nova com checkpoint: sem network.confirm em
// ConfirmTimeout, o NetworkManager volta sozinho à rede anterior (e o ajudante
// devolve os arquivos gerados). Os MACs e o hostname vêm sempre do network.json
// atual: quem chama não troca a amarração dos perfis às portas.
func (o *Ops) NetworkApply(ctx context.Context, raw json.RawMessage) (any, error) {
	var prm NetworkApplyParams
	if err := strictJSON(raw, &prm); err != nil {
		return nil, opErr(ErrInvalidParams, "parâmetros inválidos: %v", err)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if p, err := o.loadPending(); err != nil {
		return nil, opErr(ErrFailed, "%v", err)
	} else if p != nil {
		return nil, opErr(ErrConflict, "já há uma mudança de rede aguardando confirmação até %s", p.Deadline.Format(time.RFC3339))
	}
	cur, err := o.currentNetwork()
	if err != nil {
		return nil, err
	}
	var next *Network
	switch {
	case prm.Profile == "factory" && prm.Network == nil:
		next = FactoryNetwork(cur)
	case prm.Profile == "" && prm.Network != nil:
		next = prm.Network
		next.IT.MAC, next.OT.MAC, next.Hostname = cur.IT.MAC, cur.OT.MAC, cur.Hostname
		if next.NetworkVersion <= cur.NetworkVersion {
			next.NetworkVersion = cur.NetworkVersion + 1
		}
		// A origem é de quem aplica (o ajudante, no local), não de quem pede.
		next.Origin = "local"
	default:
		return nil, opErr(ErrInvalidParams, "informe network ou profile=factory")
	}
	if err := next.Validate(); err != nil {
		return nil, opErr(ErrInvalidParams, "rede inválida: %v", err)
	}

	files, err := o.generated(next)
	if err != nil {
		return nil, err
	}
	backup, err := o.backup(files)
	if err != nil {
		return nil, opErr(ErrFailed, "backup da rede atual: %v", err)
	}
	cp, err := o.Sys.CheckpointCreate(ctx, ConfirmTimeout)
	if err != nil {
		return nil, opErr(ErrFailed, "checkpoint do NetworkManager: %v", err)
	}
	p := &pending{Checkpoint: cp, Deadline: o.now().Add(ConfirmTimeout), Version: next.NetworkVersion, Backup: backup}
	if err := writeJSONFile(o.pendingPath(), p); err != nil {
		_ = o.Sys.CheckpointDestroy(ctx, cp)
		return nil, opErr(ErrFailed, "estado do ajudante: %v", err)
	}
	err = o.writeAll(files)
	if err != nil {
		err = fmt.Errorf("gravação da rede nova: %w", err)
	} else if err = o.activate(ctx); err != nil {
		err = fmt.Errorf("rede nova não subiu: %w", err)
	}
	if err != nil {
		_ = o.Sys.CheckpointRollback(ctx, cp)
		_ = o.restore(p)
		return nil, opErr(ErrFailed, "%v (voltou à rede anterior)", err)
	}
	return map[string]any{"network_version": next.NetworkVersion, "confirm_timeout_s": int(ConfirmTimeout / time.Second),
		"deadline": p.Deadline.UTC().Format(time.RFC3339)}, nil
}

func (o *Ops) activate(ctx context.Context) error {
	if err := o.Sys.ReloadConnections(ctx); err != nil {
		return err
	}
	for _, id := range []string{"oee-ot", "oee-it"} {
		if err := o.Sys.ActivateConnection(ctx, id); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
	}
	return nil
}

// fileSpec é um arquivo gerado: conteúdo nil = remover.
type fileSpec struct {
	path  string
	data  []byte
	mode  fs.FileMode
	group string
}

func (o *Ops) generated(n *Network) ([]fileSpec, error) {
	itPath, otPath := filepath.Join(o.Paths.NMDir, "oee-it.nmconnection"), filepath.Join(o.Paths.NMDir, "oee-ot.nmconnection")
	uuid := func(path, role, mac string) string {
		if b, err := os.ReadFile(path); err == nil {
			if u := keyfileUUID(b); u != "" {
				return u
			}
		}
		return stableUUID(role, mac)
	}
	r := n.render(uuid(itPath, "it", n.IT.MAC), uuid(otPath, "ot", n.OT.MAC))
	nj, err := json.MarshalIndent(n, "", "  ")
	if err != nil {
		return nil, opErr(ErrFailed, "%v", err)
	}
	return []fileSpec{
		{path: itPath, data: r.itKeyfile, mode: 0o600},
		{path: otPath, data: r.otKeyfile, mode: 0o600},
		{path: o.Paths.ProxyEnv, data: r.proxyEnv, mode: 0o640, group: o.AgentGroup},
		{path: o.Paths.ChronySources, data: r.chrony, mode: 0o644},
		{path: o.Paths.CABundle, data: r.caBundle, mode: 0o644},
		// O network.json por último: só vira a fonte quando o resto foi gravado.
		{path: o.Paths.NetworkJSON, data: append(nj, '\n'), mode: 0o640, group: o.AgentGroup},
	}, nil
}

func (o *Ops) backup(files []fileSpec) ([]backupEntry, error) {
	out := make([]backupEntry, 0, len(files))
	for _, f := range files {
		b, err := os.ReadFile(f.path)
		switch {
		case errors.Is(err, fs.ErrNotExist):
			out = append(out, backupEntry{Path: f.path})
		case err != nil:
			return nil, err
		default:
			out = append(out, backupEntry{Path: f.path, Exists: true, Data: b, Mode: f.mode, Group: f.group})
		}
	}
	return out, nil
}

func (o *Ops) writeAll(files []fileSpec) error {
	for _, f := range files {
		if f.data == nil {
			if err := os.Remove(f.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			continue
		}
		if err := o.write(f.path, f.data, f.mode, f.group); err != nil {
			return err
		}
	}
	return nil
}

// write grava atomicamente (temporário exclusivo + fsync + rename) e acerta o grupo.
func (o *Ops) write(path string, data []byte, mode fs.FileMode, group string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if group != "" {
		if err := o.Sys.Chown(tmp.Name(), group); err != nil {
			return err
		}
	}
	return os.Rename(tmp.Name(), path)
}

// NetworkConfirm confirma a rede pendente (destrói o checkpoint: ela fica).
func (o *Ops) NetworkConfirm(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := noParams(raw); err != nil {
		return nil, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	p, err := o.loadPending()
	if err != nil {
		return nil, opErr(ErrFailed, "%v", err)
	}
	if p == nil {
		return nil, opErr(ErrNothingPending, "nenhuma mudança de rede aguardando confirmação")
	}
	if !o.now().Before(p.Deadline) {
		_ = o.Sys.CheckpointRollback(ctx, p.Checkpoint)
		_ = o.restore(p)
		return nil, opErr(ErrExpired, "prazo de confirmação passou: a rede voltou à anterior")
	}
	if err := o.Sys.CheckpointDestroy(ctx, p.Checkpoint); err != nil {
		// Sem o checkpoint, o NetworkManager já voltou a rede (ou vai voltar).
		_ = o.Sys.CheckpointRollback(ctx, p.Checkpoint)
		_ = o.restore(p)
		return nil, opErr(ErrExpired, "checkpoint não existe mais (a rede voltou à anterior): %v", err)
	}
	if err := os.Remove(o.pendingPath()); err != nil {
		return nil, opErr(ErrFailed, "%v", err)
	}
	return map[string]any{"network_version": p.Version}, nil
}

// NetworkRollback volta já à rede anterior à mudança pendente.
func (o *Ops) NetworkRollback(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := noParams(raw); err != nil {
		return nil, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	p, err := o.loadPending()
	if err != nil {
		return nil, opErr(ErrFailed, "%v", err)
	}
	if p == nil {
		return nil, opErr(ErrNothingPending, "nenhuma mudança de rede pendente para voltar")
	}
	rbErr := o.Sys.CheckpointRollback(ctx, p.Checkpoint)
	if err := o.restore(p); err != nil {
		return nil, opErr(ErrFailed, "arquivos da rede anterior: %v", err)
	}
	res := map[string]any{"rolled_back": true}
	if rbErr != nil {
		res["note"] = "o NetworkManager já tinha voltado a rede"
	}
	return res, nil
}

// ClockSetParams: a hora certa (ex.: a do navegador do técnico).
type ClockSetParams struct {
	Time string `json:"time"`
}

// Limites do relógio aceito: nunca antes do build do ajudante nem num futuro absurdo.
var (
	clockMin = time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	clockMax = time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
)

// ClockSet acerta o relógio quando o NTP não sincroniza (relógio muito errado com
// NTP bloqueado impede o TLS). Com o NTP sincronizado, recusa: quem manda é ele.
func (o *Ops) ClockSet(ctx context.Context, raw json.RawMessage) (any, error) {
	var prm ClockSetParams
	if err := strictJSON(raw, &prm); err != nil {
		return nil, opErr(ErrInvalidParams, "parâmetros inválidos: %v", err)
	}
	t, err := time.Parse(time.RFC3339, prm.Time)
	if err != nil {
		return nil, opErr(ErrInvalidParams, "time deve ser RFC 3339 (ex.: 2026-11-24T10:00:00-03:00)")
	}
	if t.Before(clockMin) || !t.Before(clockMax) {
		return nil, opErr(ErrInvalidParams, "hora fora do intervalo aceito")
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if synced, err := o.Sys.NTPSynchronized(ctx); err == nil && synced {
		return nil, opErr(ErrNTPSynced, "o NTP está sincronizado: o relógio não é ajustado à mão")
	}
	before := o.now()
	if err := o.Sys.SetClock(t); err != nil {
		return nil, opErr(ErrFailed, "ajuste do relógio: %v", err)
	}
	return map[string]any{"set_to": t.UTC().Format(time.RFC3339), "delta_s": int64(t.Sub(before).Seconds())}, nil
}

// FactoryResetParams: o hostname da unidade, digitado, confirma o reset.
type FactoryResetParams struct {
	Confirm string `json:"confirm"`
}

// Arquivos do agente e da página local que o reset de fábrica apaga (credencial,
// buffer, marcadores e estado do OTA; chave TLS e sessões da página). A senha local
// (cartão lacrado) fica: ela vale para a unidade, não para o cliente.
var (
	resetAgentFiles   = []string{"credentials.json", "buffer.db", "buffer.db-wal", "buffer.db-shm", "auth-blocked", "update"}
	resetLocalUIFiles = []string{"tls", "lock.json"}
	resetUnits        = []string{"oee-gateway.service", "oee-localui.service"}
)

// FactoryReset apaga credencial, buffer e config do agente e volta a rede de
// fábrica (só root: o técnico no console, nunca pelo agente).
func (o *Ops) FactoryReset(ctx context.Context, raw json.RawMessage) (any, error) {
	var prm FactoryResetParams
	if err := strictJSON(raw, &prm); err != nil {
		return nil, opErr(ErrInvalidParams, "parâmetros inválidos: %v", err)
	}
	host, err := o.Sys.Hostname()
	if err != nil || host == "" {
		return nil, opErr(ErrFailed, "hostname ilegível")
	}
	if prm.Confirm != host {
		return nil, opErr(ErrInvalidParams, "confirme com o hostname da unidade")
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if p, err := o.loadPending(); err == nil && p != nil {
		return nil, opErr(ErrConflict, "há uma mudança de rede pendente: confirme ou volte antes")
	}
	cur, err := o.currentNetwork()
	if err != nil {
		return nil, err
	}
	for _, u := range resetUnits {
		if err := o.Sys.StopUnit(ctx, u); err != nil {
			return nil, opErr(ErrFailed, "parar %s: %v", u, err)
		}
	}
	var removed []string
	rm := func(dir string, names []string) error {
		for _, n := range names {
			p := filepath.Join(dir, n)
			if _, err := os.Lstat(p); errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err := os.RemoveAll(p); err != nil {
				return err
			}
			removed = append(removed, p)
		}
		return nil
	}
	if err := errors.Join(rm(o.Paths.AgentState, resetAgentFiles), rm(o.Paths.LocalUIState, resetLocalUIFiles)); err != nil {
		return nil, opErr(ErrFailed, "apagar o estado: %v", err)
	}
	// Rede de fábrica sem checkpoint: é root no console, e o endereço de serviço
	// (169.254) continua na OT.
	files, err := o.generated(FactoryNetwork(cur))
	if err != nil {
		return nil, err
	}
	if err := o.writeAll(files); err != nil {
		return nil, opErr(ErrFailed, "rede de fábrica: %v", err)
	}
	netErr := o.activate(ctx)
	for _, u := range resetUnits {
		_ = o.Sys.StartUnit(ctx, u)
	}
	res := map[string]any{"removed": removed}
	if netErr != nil {
		res["network_warning"] = netErr.Error()
	}
	return res, nil
}

// Arquivos do pendrive de serviço reconhecidos (só nomes fixos; nada é executado).
var usbFiles = []string{"net-reset", "diag"}

// USBRead diz quais arquivos de serviço estão no pendrive (OEE/net-reset, OEE/diag).
// Não lê conteúdo: só a presença importa no MVP. O pendrive é montado por outro
// serviço (noexec,nosuid,nodev) em Paths.USBDir.
func (o *Ops) USBRead(_ context.Context, raw json.RawMessage) (any, error) {
	if err := noParams(raw); err != nil {
		return nil, err
	}
	found := map[string]bool{}
	mounted := false
	if st, err := os.Lstat(o.Paths.USBDir); err == nil && st.IsDir() {
		mounted = true
		for _, n := range usbFiles {
			st, err := os.Lstat(filepath.Join(o.Paths.USBDir, n))
			found[n] = err == nil && st.Mode().IsRegular()
		}
	}
	return map[string]any{"mounted": mounted, "files": found}, nil
}

var checkpointRe = regexp.MustCompile(`^/org/freedesktop/NetworkManager/Checkpoint/[0-9]+$`)

// strictJSON decodifica params sem campos desconhecidos (params ausente = {}).
func strictJSON(raw json.RawMessage, v any) error {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage("{}")
	}
	return decodeStrict(raw, v)
}

func noParams(raw json.RawMessage) error {
	var empty struct{}
	if err := strictJSON(raw, &empty); err != nil {
		return opErr(ErrInvalidParams, "esta operação não tem parâmetros")
	}
	return nil
}

func writeJSONFile(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
