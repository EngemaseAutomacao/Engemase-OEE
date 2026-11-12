package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

// Níveis de resultado do diag.
const (
	diagOK      = "ok"
	diagWarn    = "aviso"
	diagFail    = "falha"
	diagPending = "pendente"
)

type diagCheck struct {
	Name   string `json:"name"`
	Result string `json:"result"`
	Detail string `json:"detail"`
}

func newDiagCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "diag",
		Short: "Diagnóstico local (esqueleto): config, credencial, buffer e DNS da nuvem",
		Long: "Confere o que dá para conferir sem o agente. Código de saída: 0 (ok), 1 (avisos), 2 (falhas).\n" +
			"Ainda pendentes: TLS e proxy até a nuvem, NTP, portas seriais e modo RS-485, links, integridade do banco pelo agente.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			path, _ := cmd.Flags().GetString("config")
			checks := runDiag(cmd.Context(), path)
			worst := 0
			for _, c := range checks {
				switch c.Result {
				case diagWarn:
					worst = max(worst, 1)
				case diagFail:
					worst = max(worst, 2)
				}
			}
			if asJSON {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				if err := enc.Encode(map[string]any{"version": buildinfo.Version, "checks": checks}); err != nil {
					return err
				}
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), buildinfo.String())
				for _, c := range checks {
					fmt.Fprintf(cmd.OutOrStdout(), "[%-8s] %-22s %s\n", c.Result, c.Name, c.Detail)
				}
			}
			if worst > 0 {
				return &ExitError{Code: worst}
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "saída em JSON")
	return cmd
}

func runDiag(ctx context.Context, path string) []diagCheck {
	var out []diagCheck
	add := func(name, result, detail string) { out = append(out, diagCheck{name, result, detail}) }

	local, err := config.LoadLocal(path)
	if err != nil {
		add("config local", diagFail, err.Error())
		return out
	}
	if _, statErr := os.Stat(path); errors.Is(statErr, os.ErrNotExist) {
		add("config local", diagWarn, path+" não existe; usando os padrões")
	} else {
		add("config local", diagOK, path)
	}

	creds, err := config.LoadCredentials(local.Paths.Credentials)
	switch {
	case err != nil:
		add("credencial", diagFail, err.Error())
	case creds == nil:
		add("credencial", diagWarn, "gateway não registrado (oee-gateway enroll --code ...)")
	default:
		who := fmt.Sprintf("gateway %s, organização %s", creds.GatewayID, creds.Org)
		switch m, merr := uplink.ReadBlockedMarker(uplink.BlockedMarkerPath(local.Paths.Credentials)); {
		case merr != nil:
			add("credencial", diagWarn, who+"; "+merr.Error())
		case m != nil:
			add("credencial", diagFail, who+": a nuvem recusa o token"+describeRefusal(m)+
				"; gere um código novo na plataforma e rode oee-gateway enroll --code ...")
		default:
			add("credencial", diagOK, who)
		}
	}

	if st, err := os.Stat(local.Paths.Buffer); err != nil {
		add("buffer", diagWarn, "ainda não criado ("+local.Paths.Buffer+")")
	} else {
		add("buffer", diagOK, fmt.Sprintf("%s (%.1f MB)", local.Paths.Buffer, float64(st.Size())/(1<<20)))
	}

	u, _ := url.Parse(local.Cloud.URL)
	dctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if addrs, err := net.DefaultResolver.LookupHost(dctx, u.Hostname()); err != nil {
		add("DNS da nuvem", diagFail, fmt.Sprintf("%s: %v", u.Hostname(), err))
	} else {
		add("DNS da nuvem", diagOK, u.Hostname()+" → "+strings.Join(addrs, ", "))
	}
	for _, name := range []string{"TLS/proxy até a nuvem", "relógio/NTP", "portas seriais", "links de rede"} {
		add(name, diagPending, "ainda não implementado neste esqueleto")
	}
	return out
}
