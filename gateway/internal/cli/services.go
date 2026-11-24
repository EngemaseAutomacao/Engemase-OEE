package cli

import (
	"context"
	"fmt"
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
			dir, _ := cmd.Flags().GetString("tls-dir")
			if dir == "" {
				dir = localui.DefaultTLSDir
				if sd := os.Getenv("STATE_DIRECTORY"); sd != "" {
					dir = filepath.Join(sd, "tls")
				}
			}
			l, err := serviceListener("https", listen)
			if err != nil {
				return err
			}
			log := app.NewLogger("info")
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			log.Info("página local iniciada", "endereco", l.Addr().String())
			return (&localui.Server{TLSDir: dir, Log: log}).Serve(ctx, l)
		},
	}
	serve.Flags().String("listen", "", "endereço próprio (só bancada/desenvolvimento, ex.: 127.0.0.1:8443); padrão: socket do systemd")
	serve.Flags().String("tls-dir", "", "diretório da chave e do certificado (padrão: $STATE_DIRECTORY/tls ou "+localui.DefaultTLSDir+")")
	root.AddCommand(serve)
	return root
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
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return (&helper.Server{AgentGID: gid, IdleExit: idle, Log: log}).Serve(ctx, l)
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
