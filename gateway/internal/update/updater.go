package update

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
)

// System é o que o updater pede ao sistema (dpkg e systemd). A implementação real
// está em system.go; os testes usam uma falsa.
type System interface {
	// DebFields lê Package, Version e Architecture do .deb (dpkg-deb -f).
	DebFields(ctx context.Context, deb string) (pkg, version, arch string, err error)
	// InstalledVersion é a versão instalada do pacote ("" se não instalado).
	InstalledVersion(ctx context.Context, pkg string) (string, error)
	// Arch é a arquitetura do dpkg (dpkg --print-architecture).
	Arch(ctx context.Context) (string, error)
	// Install roda dpkg -i (sem perguntas sobre conffiles).
	Install(ctx context.Context, deb string) error
	// ConfigurePending roda dpkg --configure -a (atualização interrompida).
	ConfigurePending(ctx context.Context) error
	// RestartAgent reinicia o oee-gateway.service sem esperar.
	RestartAgent(ctx context.Context) error
	// StartUpdater enfileira o oee-gateway-updater.service (boot-check).
	StartUpdater(ctx context.Context) error
}

// Fases do state.json.
const (
	phaseInstalling = "installing" // dpkg -i do pacote novo em curso
	phaseWaiting    = "waiting"    // pacote novo instalado, esperando a saúde
)

// maxResumes: quantas vezes uma atualização interrompida (reboot no meio) é
// retomada antes de desistir e voltar ao anterior.
const maxResumes = 3

// state é a atualização em curso (StateDir/state.json, root 0600).
type state struct {
	ID        string    `json:"id"`
	Phase     string    `json:"phase"`
	Target    string    `json:"target"`
	Previous  string    `json:"previous"`
	StartedAt time.Time `json:"started_at"`
	Deadline  time.Time `json:"deadline"`
	Resumes   int       `json:"resumes"`
}

// Updater é o oee-updater (root). Cada pacote vive num diretório próprio do
// StateDir (current/, staging/, previous/) com o .deb, o manifesto e a assinatura:
// o rollback reinstala o current/ sem depender de nada que o usuário oee escreva.
type Updater struct {
	UpdateDir  string // troca com o agente (DefaultUpdateDir)
	StateDir   string // /var/lib/oee-gateway-updater (StateDirectory, root 0700)
	Keys       []ed25519.PublicKey
	BufferPath string // buffer.db do agente (L25)
	Sys        System
	Log        *slog.Logger
	// HealthTimeout: o agente novo tem esse prazo para o 1º /sync aceito (5 min).
	HealthTimeout time.Duration
	// Poll é o intervalo de leitura do health.json.
	Poll time.Duration
	Now  func() time.Time
}

// Erros de recusa (vão no result.json como reason).
var (
	ErrNoPrevious = errors.New("sem pacote anterior registrado para o rollback (rode oee-updater seed na bancada)")
	ErrDowngrade  = errors.New("versão mais antiga que a instalada fora de allowed_rollback_to")
)

const agentPackage = "oee-gateway"

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

func (u *Updater) defaults() {
	if u.Log == nil {
		u.Log = slog.Default()
	}
	if u.HealthTimeout <= 0 {
		u.HealthTimeout = 5 * time.Minute
	}
	if u.Poll <= 0 {
		u.Poll = 2 * time.Second
	}
}

func (u *Updater) dir(name string) string { return filepath.Join(u.StateDir, name) }
func (u *Updater) statePath() string      { return u.dir("state.json") }

// O diretório de troca é do usuário oee: tudo nele passa por xferDir (sem seguir
// link simbólico, relativo a um descritor do diretório).

func (u *Updater) xread(name string, max int64, v any) error {
	d, err := openXfer(u.UpdateDir)
	if err != nil {
		return err
	}
	defer d.Close()
	f, err := d.open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return err
	}
	if int64(len(b)) > max {
		return fmt.Errorf("%s: grande demais", name)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s ilegível: %w", name, err)
	}
	return nil
}

func (u *Updater) xcopy(name, dst string, max int64) (int64, string, error) {
	d, err := openXfer(u.UpdateDir)
	if err != nil {
		return 0, "", err
	}
	defer d.Close()
	f, err := d.open(name)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()
	return copyFrom(f, dst, max)
}

func (u *Updater) xremove(names ...string) {
	d, err := openXfer(u.UpdateDir)
	if err != nil {
		return
	}
	defer d.Close()
	for _, n := range names {
		if err := d.remove(n); err != nil {
			u.Log.Warn("não apagou do diretório de troca", "arquivo", n, "erro", err)
		}
	}
}

func (u *Updater) xwriteJSON(name string, v any, mode os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	d, err := openXfer(u.UpdateDir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.writeAtomic(name, append(b, '\n'), mode)
}

// Apply é o oee-updater apply: retoma uma atualização em curso (state.json) ou
// atende o request.json do agente.
func (u *Updater) Apply(ctx context.Context) error {
	u.defaults()
	unlock, err := u.lock()
	if err != nil {
		return err
	}
	defer unlock()
	if st, err := u.loadState(); err != nil {
		return err
	} else if st != nil {
		return u.resume(ctx, st)
	}
	var req Request
	if err := u.xread(RequestFile, 4<<10, &req); errors.Is(err, fs.ErrNotExist) {
		u.Log.Info("nenhum pedido de atualização")
		return nil
	} else if err != nil {
		return u.reject(Request{}, "bad_request", err)
	}
	return u.start(ctx, req)
}

func (u *Updater) lock() (func(), error) {
	if err := os.MkdirAll(u.StateDir, 0o700); err != nil {
		return nil, err
	}
	return lockFile(u.dir("lock"))
}

// stage copia o manifesto, a assinatura e o .deb do diretório do agente para
// staging/ (root) e confere tudo na cópia.
func (u *Updater) stage(ctx context.Context, req Request) (*Manifest, error) {
	st := u.dir("staging")
	if err := os.RemoveAll(st); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(st, 0o700); err != nil {
		return nil, err
	}
	if _, _, err := u.xcopy(ManifestFile, filepath.Join(st, ManifestFile), MaxManifestSize); err != nil {
		return nil, fmt.Errorf("manifesto: %w", err)
	}
	if _, _, err := u.xcopy(SignatureFile, filepath.Join(st, SignatureFile), maxSigFile); err != nil {
		return nil, fmt.Errorf("assinatura: %w", err)
	}
	m, err := u.verifyDir(st)
	if err != nil {
		return nil, err
	}
	if req.Version != "" && req.Version != m.Version {
		return nil, fmt.Errorf("pedido de %s, manifesto de %s", req.Version, m.Version)
	}
	n, sum, err := u.xcopy(PackageFile, filepath.Join(st, PackageFile), m.Size)
	if err != nil {
		return nil, fmt.Errorf("pacote: %w", err)
	}
	if n != m.Size || sum != m.SHA256 {
		return nil, errors.New("pacote não confere com o manifesto (tamanho ou SHA-256)")
	}
	if err := u.checkDeb(ctx, filepath.Join(st, PackageFile), m); err != nil {
		return nil, err
	}
	return m, nil
}

// verifyDir confere a assinatura e lê o manifesto de um diretório do StateDir.
func (u *Updater) verifyDir(dir string) (*Manifest, error) {
	mb, err := readLimited(filepath.Join(dir, ManifestFile), MaxManifestSize)
	if err != nil {
		return nil, err
	}
	sb, err := readLimited(filepath.Join(dir, SignatureFile), maxSigFile)
	if err != nil {
		return nil, err
	}
	if err := VerifyManifest(u.Keys, mb, sb); err != nil {
		return nil, err
	}
	return ParseManifest(mb)
}

// checkDeb confere os campos do .deb contra o manifesto e a máquina.
func (u *Updater) checkDeb(ctx context.Context, deb string, m *Manifest) error {
	pkg, ver, arch, err := u.Sys.DebFields(ctx, deb)
	if err != nil {
		return fmt.Errorf("campos do .deb: %w", err)
	}
	mach, err := u.Sys.Arch(ctx)
	if err != nil {
		return err
	}
	switch {
	case pkg != agentPackage:
		return fmt.Errorf("o .deb é do pacote %q", pkg)
	case ver != DebVersion(m.Version):
		return fmt.Errorf("o .deb é da versão %s, o manifesto diz %s", ver, m.Version)
	case arch != m.Arch || arch != mach:
		return fmt.Errorf("o .deb é %s, o manifesto diz %s e a máquina é %s", arch, m.Arch, mach)
	}
	return nil
}

func (u *Updater) start(ctx context.Context, req Request) error {
	m, err := u.stage(ctx, req)
	if err != nil {
		return u.reject(req, "verification_failed", err)
	}
	cur, err := u.verifyDir(u.dir("current"))
	if err != nil {
		return u.reject(req, "no_previous_package", fmt.Errorf("%w: %v", ErrNoPrevious, err))
	}
	installed, err := u.Sys.InstalledVersion(ctx, agentPackage)
	if err != nil {
		return u.reject(req, "dpkg", err)
	}
	if installed != DebVersion(cur.Version) {
		return u.reject(req, "no_previous_package",
			fmt.Errorf("%w: o pacote guardado é %s, o instalado é %s", ErrNoPrevious, cur.Version, installed))
	}
	cmp, err := CompareVersions(m.Version, cur.Version)
	if err != nil {
		return u.reject(req, "verification_failed", err)
	}
	if cmp == 0 {
		u.cleanup(true)
		return u.finish(Result{ID: req.ID, Status: "unchanged", Version: m.Version, Previous: cur.Version})
	}
	if cmp < 0 {
		if !slices.Contains(cur.AllowedRollbackTo, m.Version) {
			return u.reject(req, "downgrade_not_allowed", fmt.Errorf("%w (%s → %s)", ErrDowngrade, cur.Version, m.Version))
		}
	}
	// L25 para qualquer instalação: um pacote que não abre o buffer do disco deixaria
	// o gateway sem coleta (vale para a volta manual da frota e para o automático).
	if schema, err := buffer.FileSchemaVersion(u.BufferPath); err != nil {
		return u.reject(req, "buffer_schema", err)
	} else if err := CheckAutoRollback(m, schema); err != nil {
		return u.reject(req, "buffer_schema", err)
	}

	now := u.now()
	st := &state{ID: req.ID, Phase: phaseInstalling, Target: m.Version, Previous: cur.Version, StartedAt: now,
		Deadline: now.Add(u.HealthTimeout)}
	if err := writeJSON(u.statePath(), st, 0o600); err != nil {
		return err
	}
	u.xremove(HealthFile)
	u.Log.Info("instalando o agente novo", "versao", m.Version, "anterior", cur.Version, "pedido", req.ID)
	if err := u.Sys.Install(ctx, u.dir("staging/"+PackageFile)); err != nil {
		u.Log.Error("dpkg -i do agente novo falhou", "erro", err)
		return u.rollback(ctx, st, "install_failed", err)
	}
	return u.waitHealth(ctx, st)
}

// waitHealth reinicia o agente e espera o health.json da versão nova.
func (u *Updater) waitHealth(ctx context.Context, st *state) error {
	st.Phase = phaseWaiting
	if err := writeJSON(u.statePath(), st, 0o600); err != nil {
		return err
	}
	if err := u.Sys.RestartAgent(ctx); err != nil {
		u.Log.Warn("reinício do agente falhou", "erro", err)
	}
	t := time.NewTicker(u.Poll)
	defer t.Stop()
	for {
		var h Health
		if err := u.xread(HealthFile, 4<<10, &h); err == nil && h.Version == st.Target && !h.At.Before(st.StartedAt.Add(-time.Minute)) {
			return u.commit(st)
		}
		if !u.now().Before(st.Deadline) {
			return u.rollback(ctx, st, "health_timeout",
				fmt.Errorf("o agente %s não fez um /sync aceito em %s", st.Target, u.HealthTimeout))
		}
		select {
		case <-ctx.Done():
			// SIGTERM (desligamento): o state.json fica e o boot-check retoma.
			return ctx.Err()
		case <-t.C:
		}
	}
}

// commit: o agente novo está saudável; ele passa a ser o current/.
func (u *Updater) commit(st *state) error {
	if err := os.RemoveAll(u.dir("previous")); err != nil {
		return err
	}
	if err := os.Rename(u.dir("current"), u.dir("previous")); err != nil {
		return err
	}
	if err := os.Rename(u.dir("staging"), u.dir("current")); err != nil {
		return err
	}
	if err := syncDir(u.StateDir); err != nil {
		return err
	}
	u.Log.Info("agente atualizado", "versao", st.Target, "anterior", st.Previous)
	u.cleanup(false)
	return u.finish(Result{ID: st.ID, Status: "applied", Version: st.Target, Previous: st.Previous})
}

// rollback volta o pacote anterior (current/), se o buffer deixar (L25).
func (u *Updater) rollback(ctx context.Context, st *state, reason string, cause error) error {
	prev, err := u.verifyDir(u.dir("current"))
	if err != nil {
		u.cleanup(false)
		_ = u.finish(Result{ID: st.ID, Status: "rollback_failed", Version: st.Target, Previous: st.Previous, Reason: reason,
			Message: "pacote anterior ilegível: " + err.Error()})
		return fmt.Errorf("rollback impossível: %w", err)
	}
	schema, err := buffer.FileSchemaVersion(u.BufferPath)
	if err == nil {
		err = CheckAutoRollback(prev, schema)
	}
	if err != nil {
		// O agente novo já migrou o buffer (ou não dá para saber): fica o novo, e o
		// gateway entra na lista "atenção" da frota.
		u.Log.Error("rollback recusado (L25): o agente novo fica", "erro", err, "motivo", reason)
		u.cleanup(false)
		_ = u.finish(Result{ID: st.ID, Status: "rollback_refused", Version: st.Target, Previous: st.Previous, Reason: reason,
			Message: cause.Error() + "; " + err.Error()})
		return err
	}
	u.Log.Warn("voltando ao agente anterior", "anterior", prev.Version, "motivo", reason, "causa", cause)
	if err := u.Sys.Install(ctx, u.dir("current/"+PackageFile)); err != nil {
		u.Log.Error("reinstalar o agente anterior falhou", "erro", err)
		u.cleanup(false)
		_ = u.finish(Result{ID: st.ID, Status: "rollback_failed", Version: st.Target, Previous: st.Previous, Reason: reason,
			Message: err.Error()})
		return err
	}
	if err := u.Sys.RestartAgent(ctx); err != nil {
		u.Log.Warn("reinício do agente anterior falhou", "erro", err)
	}
	u.cleanup(false)
	return u.finish(Result{ID: st.ID, Status: "rolled_back", Version: st.Target, Previous: st.Previous, Reason: reason,
		Message: cause.Error()})
}

// resume retoma uma atualização interrompida (reboot ou queda de energia).
func (u *Updater) resume(ctx context.Context, st *state) error {
	st.Resumes++
	u.Log.Warn("retomando atualização interrompida", "fase", st.Phase, "versao", st.Target, "retomada", st.Resumes)
	if st.Resumes > maxResumes {
		return u.rollback(ctx, st, "too_many_resumes", fmt.Errorf("interrompida %d vezes", st.Resumes-1))
	}
	installed, err := u.Sys.InstalledVersion(ctx, agentPackage)
	if err != nil || installed != DebVersion(st.Target) {
		return u.rollback(ctx, st, "interrupted", fmt.Errorf("instalação interrompida (instalado: %q)", installed))
	}
	// O relógio de antes do reboot não serve: prazo cheio a partir de agora.
	st.Deadline = u.now().Add(u.HealthTimeout)
	return u.waitHealth(ctx, st)
}

// BootCheck é o oee-updater boot-check (antes do agente, em todo boot): sem
// atualização em curso sai na hora; com ela, conserta o dpkg e enfileira o apply.
// Nunca espera a saúde aqui: o agente só sobe depois desta unit.
func (u *Updater) BootCheck(ctx context.Context) error {
	u.defaults()
	unlock, err := u.lock()
	if err != nil {
		return err
	}
	defer unlock()
	st, err := u.loadState()
	if err != nil || st == nil {
		return err
	}
	u.Log.Warn("atualização interrompida encontrada no boot", "fase", st.Phase, "versao", st.Target)
	if err := u.Sys.ConfigurePending(ctx); err != nil {
		u.Log.Error("dpkg --configure -a falhou", "erro", err)
	}
	return u.Sys.StartUpdater(ctx)
}

// Seed registra o pacote instalado como current/ (bancada ou instalação manual):
// sem ele o primeiro OTA não teria para onde voltar. Confere a assinatura e que o
// .deb é exatamente a versão instalada.
func (u *Updater) Seed(ctx context.Context, manifest, sig, deb string) error {
	u.defaults()
	unlock, err := u.lock()
	if err != nil {
		return err
	}
	defer unlock()
	tmp := u.dir("seed")
	if err := os.RemoveAll(tmp); err != nil {
		return err
	}
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	for _, f := range []struct {
		src, name string
		max       int64
	}{{manifest, ManifestFile, MaxManifestSize}, {sig, SignatureFile, maxSigFile}, {deb, PackageFile, MaxPackageSize}} {
		if _, _, err := copyVerified(f.src, filepath.Join(tmp, f.name), f.max); err != nil {
			return err
		}
	}
	m, err := u.verifyDir(tmp)
	if err != nil {
		return err
	}
	if n, sum, err := fileSHA256(filepath.Join(tmp, PackageFile)); err != nil || n != m.Size || sum != m.SHA256 {
		return errors.New("pacote não confere com o manifesto (tamanho ou SHA-256)")
	}
	if err := u.checkDeb(ctx, filepath.Join(tmp, PackageFile), m); err != nil {
		return err
	}
	installed, err := u.Sys.InstalledVersion(ctx, agentPackage)
	if err != nil {
		return err
	}
	if installed != DebVersion(m.Version) {
		return fmt.Errorf("o instalado é %q, o pacote é %s: instale-o antes (dpkg -i)", installed, m.Version)
	}
	if err := os.RemoveAll(u.dir("current")); err != nil {
		return err
	}
	if err := os.Rename(tmp, u.dir("current")); err != nil {
		return err
	}
	u.Log.Info("pacote atual registrado para rollback", "versao", m.Version)
	return syncDir(u.StateDir)
}

func (u *Updater) loadState() (*state, error) {
	var st state
	if err := readJSON(u.statePath(), 16<<10, &st); errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	return &st, nil
}

// reject recusa o pedido sem tocar no sistema.
func (u *Updater) reject(req Request, reason string, err error) error {
	u.Log.Error("atualização recusada", "motivo", reason, "erro", err, "pedido", req.ID)
	u.cleanup(true)
	_ = u.finish(Result{ID: req.ID, Status: "rejected", Version: req.Version, Reason: reason, Message: err.Error()})
	return err
}

// cleanup apaga o pedido e o estado (e o staging/, se pedido). O pedido some por
// último: sem ele o .path não dispara de novo.
func (u *Updater) cleanup(staging bool) {
	if staging {
		_ = os.RemoveAll(u.dir("staging"))
	}
	_ = os.Remove(u.statePath())
	u.xremove(PackageFile, ManifestFile, SignatureFile, HealthFile, RequestFile)
}

// finish grava o result.json para o agente (e o journal).
func (u *Updater) finish(r Result) error {
	r.At = u.now().UTC()
	if err := u.xwriteJSON(ResultFile, r, 0o644); err != nil {
		u.Log.Error("result.json não gravado", "erro", err)
		return err
	}
	u.Log.Info("resultado da atualização", "status", r.Status, "versao", r.Version, "anterior", r.Previous, "motivo", r.Reason)
	return nil
}
