// Comando oee-remote-access: VPN de manutenção sob demanda do gateway (docs/12).
//
// Ativado pelo systemd (oee-remote-access.socket, /run/oee-gateway/remote-access.sock) quando o agente
// recebe um vpn.enable; sai sozinho quando fica ocioso. Confere a aprovação assinada (chaves em
// /usr/share/oee-remote-access/keys) e a política local, liga a rede com tsnet (rede em espaço de usuário,
// sem mexer nas rotas do sistema), escuta SÓ a porta 22 na VPN e a repassa ao OpenSSH local
// (127.0.0.1:22). O estado da VPN fica só na memória: depois de reiniciar, ela não religa.
//
// Módulo próprio: a biblioteca do Tailscale não entra no agente de coleta (oee-gateway).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"os/user"
	"strconv"
	"syscall"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/remoteaccess"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/sdlisten"
	"tailscale.com/ipn/store/mem"
	"tailscale.com/tsnet"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "oee-remote-access:", err)
		os.Exit(1)
	}
}

func run() error {
	keysDir := flag.String("keys", remoteaccess.DefaultKeysDir, "pasta das chaves públicas da aprovação")
	policy := flag.String("policy", remoteaccess.DefaultPolicyPath, "política local (remote-access.json)")
	group := flag.String("agent-group", "oee", "grupo do agente que pode pedir")
	idle := flag.Duration("idle-exit", 10*time.Minute, "sai depois desse tempo sem sessão nem pedidos (0 = nunca)")
	runtimeDir := flag.String("runtime-dir", os.Getenv("RUNTIME_DIRECTORY"), "pasta temporária (tmpfs) para a VPN")
	listen := flag.String("listen", "", "socket unix para testes (sem o systemd)")
	version := flag.Bool("version", false, "mostra a versão")
	flag.Parse()
	if *version {
		fmt.Println(buildinfo.Version)
		return nil
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	keys, err := remoteaccess.LoadKeys(*keysDir)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		log.Warn("nenhuma chave de aprovação instalada: todo vpn.enable será recusado", "pasta", *keysDir)
	}
	g, err := user.LookupGroup(*group)
	if err != nil {
		return fmt.Errorf("grupo do agente %q: %w", *group, err)
	}
	gid, err := strconv.ParseUint(g.Gid, 10, 32)
	if err != nil {
		return err
	}

	var l net.Listener
	if *listen != "" {
		l, err = net.Listen("unix", *listen)
	} else {
		var ls map[string][]net.Listener
		if ls, err = sdlisten.Listeners(); err == nil {
			l, err = sdlisten.One(ls, "remote-access")
		}
	}
	if err != nil {
		return err
	}

	dir := *runtimeDir
	if dir == "" {
		dir = os.TempDir()
	}
	m := &remoteaccess.Manager{Net: &tsNetwork{dir: dir, log: log}, Keys: keys, PolicyPath: *policy, Log: log}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	log.Info("oee-remote-access pronto", "versao", buildinfo.Version, "chaves", len(keys))
	return (&remoteaccess.Server{Manager: m, AgentGID: uint32(gid), IdleExit: *idle, Log: log}).Serve(ctx, l)
}

// tsNetwork liga a VPN com tsnet. Estado só em memória (mem.Store) e numa pasta temporária apagada no fim.
type tsNetwork struct {
	dir string
	log *slog.Logger
}

func (n *tsNetwork) Up(ctx context.Context, o remoteaccess.UpOptions) (remoteaccess.Tunnel, error) {
	dir, err := os.MkdirTemp(n.dir, "vpn-")
	if err != nil {
		return nil, err
	}
	s := &tsnet.Server{
		Dir:        dir,
		Store:      new(mem.Store), // chave do nó só na memória: depois de reiniciar, não religa
		Hostname:   o.NodeName,
		AuthKey:    o.AuthKey,
		ControlURL: o.ControlURL,
		Ephemeral:  false, // nó com tag, apagado pela plataforma no fim (docs/12)
		// O log interno do tsnet é muito falante; só os avisos para o usuário vão ao journal.
		Logf:     func(string, ...any) {},
		UserLogf: func(format string, args ...any) { n.log.Info("tsnet: " + fmt.Sprintf(format, args...)) },
	}
	st, err := s.Up(ctx)
	if err != nil {
		_ = s.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	ip := ""
	for _, a := range st.TailscaleIPs {
		if a.Is4() {
			ip = a.String()
			break
		}
	}
	return &tsTunnel{s: s, dir: dir, ip: ip}, nil
}

type tsTunnel struct {
	s   *tsnet.Server
	dir string
	ip  string
}

// Listen escuta SÓ na VPN (nunca nas interfaces da fábrica).
func (t *tsTunnel) Listen(port int) (net.Listener, error) {
	return t.s.Listen("tcp", ":"+strconv.Itoa(port))
}

func (t *tsTunnel) IP() string { return t.ip }

// Connection: "direct" se algum par tem caminho direto, "relay" se só pelo relay (DERP).
func (t *tsTunnel) Connection() string {
	lc, err := t.s.LocalClient()
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	st, err := lc.Status(ctx)
	if err != nil {
		return ""
	}
	relay := false
	for _, p := range st.Peer {
		if p.CurAddr != "" {
			if _, err := netip.ParseAddrPort(p.CurAddr); err == nil {
				return "direct"
			}
		}
		if p.Relay != "" {
			relay = true
		}
	}
	if relay {
		return "relay"
	}
	return ""
}

func (t *tsTunnel) Close() error {
	err := t.s.Close()
	if rmErr := os.RemoveAll(t.dir); rmErr != nil && !errors.Is(rmErr, os.ErrNotExist) && err == nil {
		err = rmErr
	}
	return err
}
