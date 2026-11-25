package cli

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/app"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/helper"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localui"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/sdlisten"
)

// Processos da Fase 1 que usam o mesmo binário (deploy/gateway/systemd/fase1):
// "localui serve" (oee-localui.service) e "helper serve" (oee-helper.service).

func newLocalUICmd() *cobra.Command {
	root := &cobra.Command{Use: "localui", Short: "Página local de comissionamento (oee-localui)"}
	serve := &cobra.Command{
		Use:   "serve",
		Short: "Atende a página local no socket do systemd (oee-localui.socket, porta 443 na OT)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			listen, _ := cmd.Flags().GetString("listen")
			state := localUIStateDir(cmd)
			dir, _ := cmd.Flags().GetString("tls-dir")
			if dir == "" {
				dir = filepath.Join(state, "tls")
			}
			sock, _ := cmd.Flags().GetString("agent-socket")
			l, err := serviceListener("https", listen)
			if err != nil {
				return err
			}
			log := app.NewLogger("info")
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			log.Info("página local iniciada", "endereco", l.Addr().String())
			return (&localui.Server{StateDir: state, TLSDir: dir, Agent: localapi.NewClient(sock), Log: log}).Serve(ctx, l)
		},
	}
	serve.Flags().String("listen", "", "endereço próprio (só bancada/desenvolvimento, ex.: 127.0.0.1:8443); padrão: socket do systemd")
	serve.Flags().String("tls-dir", "", "chave e certificado gerados pela página (padrão: <state-dir>/tls)")
	serve.Flags().String("agent-socket", localapi.DefaultSocket, "API local do agente")

	passwd := &cobra.Command{
		Use:   "passwd",
		Short: "Define a senha local da página (bancada; root)",
		Long: "Grava o hash argon2id da senha local em <state-dir>/" + localui.PasswordFile + ".\n" +
			"--stdin lê a senha da entrada (uma linha; usado pelo factory init); --generate gera uma\n" +
			"senha nova e a mostra UMA vez (anote no cartão lacrado). A senha é normalizada como no\n" +
			"cartão: sem hífens nem espaços, em maiúsculas.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			fromStdin, _ := cmd.Flags().GetBool("stdin")
			gen, _ := cmd.Flags().GetBool("generate")
			if fromStdin == gen {
				return errors.New("use --stdin ou --generate")
			}
			var pw string
			if gen {
				p, err := localui.GeneratePassword()
				if err != nil {
					return err
				}
				pw = p
			} else {
				line, err := bufio.NewReader(io.LimitReader(cmd.InOrStdin(), 1024)).ReadString('\n')
				if err != nil && line == "" {
					return errors.New("senha não recebida na entrada")
				}
				pw = line
			}
			phc, err := localui.HashPassword(localui.NormalizePassword(pw))
			if err != nil {
				return err
			}
			state := localUIStateDir(cmd)
			if err := localui.WritePasswordHash(state, phc); err != nil {
				return err
			}
			// A página roda como oee-ui (StateDirectory=oee-localui, 0700): o arquivo
			// gravado pelo root passa a ser dela.
			if os.Geteuid() == 0 {
				if u, err := user.Lookup(app.UIGroup); err == nil {
					uid, _ := strconv.Atoi(u.Uid)
					gid, _ := strconv.Atoi(u.Gid)
					_ = os.Chown(state, uid, gid)
					if err := os.Chown(filepath.Join(state, localui.PasswordFile), uid, gid); err != nil {
						return err
					}
				}
			}
			if gen {
				fmt.Fprintln(cmd.OutOrStdout(), "Senha local (mostrada só agora; anote no cartão lacrado):", pw)
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), "senha local gravada")
			}
			return nil
		},
	}
	passwd.Flags().Bool("stdin", false, "lê a senha da entrada padrão")
	passwd.Flags().Bool("generate", false, "gera e mostra uma senha nova")
	root.PersistentFlags().String("state-dir", "", "estado da página (padrão: $STATE_DIRECTORY ou "+localui.DefaultStateDir+")")
	root.AddCommand(serve, passwd)
	return root
}

func localUIStateDir(cmd *cobra.Command) string {
	if d, _ := cmd.Flags().GetString("state-dir"); d != "" {
		return d
	}
	if sd := os.Getenv("STATE_DIRECTORY"); sd != "" {
		return sd
	}
	return localui.DefaultStateDir
}

func newHelperCmd() *cobra.Command {
	root := &cobra.Command{Use: "helper", Short: "Ajudante privilegiado de operações fechadas (oee-helper)"}
	serve := &cobra.Command{
		Use:   "serve",
		Short: "Atende o socket do systemd (oee-helper.socket); sai sozinho quando ocioso",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			listen, _ := cmd.Flags().GetString("listen")
			idle, _ := cmd.Flags().GetDuration("idle")
			group, _ := cmd.Flags().GetString("agent-group")
			l, err := serviceListener("helper", listen)
			if err != nil {
				return err
			}
			log := app.NewLogger("info")
			gid := ^uint32(0) // sem o grupo do agente: só root
			if g, err := user.LookupGroup(group); err == nil {
				if n, err := strconv.ParseUint(g.Gid, 10, 32); err == nil {
					gid = uint32(n)
				}
			} else {
				log.Warn("grupo do agente não encontrado: só root é atendido", "grupo", group, "erro", err)
			}
			paths := helper.DefaultPaths()
			if sd := os.Getenv("STATE_DIRECTORY"); sd != "" {
				paths.StateDir = sd
			}
			ops := &helper.Ops{Sys: helper.OSSystem{}, Paths: paths, AgentGroup: group}
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return (&helper.Server{AgentGID: gid, IdleExit: idle, Log: log, Ops: ops}).Serve(ctx, l)
		},
	}
	serve.Flags().String("listen", "", "socket Unix próprio (só bancada/desenvolvimento); padrão: socket do systemd")
	serve.Flags().Duration("idle", 60*time.Second, "sai depois desse tempo sem pedido (0 = nunca)")
	serve.Flags().String("agent-group", "oee", "grupo do agente (chamadores desse grupo têm as operações do agente)")
	root.AddCommand(serve)
	return root
}

// serviceListener pega o socket do systemd pelo FileDescriptorName= ou, só para
// bancada, abre listen (TCP host:porta ou caminho de socket Unix).
func serviceListener(name, listen string) (net.Listener, error) {
	if listen != "" {
		if filepath.IsAbs(listen) {
			return net.Listen("unix", listen)
		}
		return net.Listen("tcp", listen)
	}
	ls, err := sdlisten.Listeners()
	if err != nil {
		return nil, err
	}
	l, err := sdlisten.One(ls, name)
	if err != nil {
		return nil, fmt.Errorf("%w (fora do systemd, use --listen)", err)
	}
	return l, nil
}
