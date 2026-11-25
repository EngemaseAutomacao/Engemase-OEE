package localui

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	_ "time/tzdata" // horário de Brasília mesmo sem /usr/share/zoneinfo

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
)

// Fuso das telas: o técnico lê o horário local da fábrica.
var brt = func() *time.Location {
	if l, err := time.LoadLocation("America/Sao_Paulo"); err == nil {
		return l
	}
	return time.FixedZone("BRT", -3*3600)
}()

// cloudOnlineWithin: último /sync aceito há menos que isso = nuvem "online".
const cloudOnlineWithin = 5 * time.Minute

func clientIP(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

func (s *Server) loggedIn(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	return err == nil && s.sess.valid(c.Value, s.Now())
}

// readHash lê o hash da senha local ("" se não foi definida).
func (s *Server) readHash() (string, error) {
	b, err := os.ReadFile(filepath.Join(s.StateDir, PasswordFile))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

type loginData struct {
	Version, Host, Error string
	NoPassword           bool
	LockedUntil          string
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	if s.loggedIn(r) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	d := s.loginData(r)
	s.render(w, http.StatusOK, loginTmpl, d)
}

func (s *Server) loginData(r *http.Request) loginData {
	host, _ := os.Hostname()
	d := loginData{Version: buildinfo.Version, Host: host}
	if h, err := s.readHash(); err != nil || h == "" {
		d.NoPassword = true
	}
	if until := s.lim.blocked(clientIP(r), s.Now()); !until.IsZero() {
		d.LockedUntil = until.In(brt).Format("15:04")
	}
	return d
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	now := s.Now()
	d := s.loginData(r)
	if d.LockedUntil != "" {
		s.Log.Warn("página local: login bloqueado", "ip", ip)
		s.render(w, http.StatusTooManyRequests, loginTmpl, d)
		return
	}
	if err := r.ParseForm(); err != nil {
		d.Error = "Formulário inválido."
		s.render(w, http.StatusBadRequest, loginTmpl, d)
		return
	}
	hash, err := s.readHash()
	if err != nil || hash == "" {
		d.NoPassword = true
		s.render(w, http.StatusServiceUnavailable, loginTmpl, d)
		return
	}
	pw := NormalizePassword(r.PostForm.Get("senha"))
	s.verifyMu.Lock()
	ok, err := VerifyPassword(hash, pw)
	s.verifyMu.Unlock()
	if err != nil {
		s.Log.Error("página local: hash da senha local ilegível", "erro", err)
		d.Error = "A senha local deste gateway está com problema. Defina de novo pelo terminal."
		s.render(w, http.StatusServiceUnavailable, loginTmpl, d)
		return
	}
	if !ok {
		s.lim.fail(ip, now)
		s.Log.Warn("página local: senha errada", "ip", ip)
		d = s.loginData(r)
		d.Error = "Senha incorreta."
		status := http.StatusUnauthorized
		if d.LockedUntil != "" {
			status = http.StatusTooManyRequests
		}
		s.render(w, status, loginTmpl, d)
		return
	}
	s.lim.ok(ip)
	tok, err := s.sess.create(ip, now)
	if err != nil {
		http.Error(w, "falha interna", http.StatusInternalServerError)
		return
	}
	s.Log.Info("página local: login", "ip", ip)
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: tok, Path: "/", Secure: true, HttpOnly: true,
		SameSite: http.SameSiteStrictMode})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.sess.drop(c.Value)
		s.Log.Info("página local: saída", "ip", clientIP(r))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", Secure: true, HttpOnly: true,
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
	http.Redirect(w, r, "/entrar", http.StatusSeeOther)
}

// Linhas das tabelas, já em português.
type statusData struct {
	Version, Host, Now string
	AgentErr           string
	St                 *localapi.Status
	Cloud              cloudView
	Queue              queueView
	Devices            []deviceView
	Machines           []machineView
	Started, Config    string
}

type cloudView struct {
	Label, Class, LastOK, Error, Clock, URL string
}

type queueView struct {
	Pending, Quarantined int64
	Oldest, Class, Error string
}

type deviceView struct {
	Name, ID, Protocol, Label, Class, Latency, LastOK, Error string
	Errors                                                   int64
}

type machineView struct {
	Name, ID, State, Class, Since, Counter, Product, Fault, At string
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	if !s.loggedIn(r) {
		http.Redirect(w, r, "/entrar", http.StatusSeeOther)
		return
	}
	now := s.Now()
	host, _ := os.Hostname()
	d := statusData{Version: buildinfo.Version, Host: host, Now: now.In(brt).Format("02/01/2006 15:04:05")}
	if s.Agent == nil {
		d.AgentErr = "API local do agente não configurada."
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		st, err := s.Agent.Status(ctx)
		cancel()
		if err != nil {
			s.Log.Warn("página local: agente não respondeu", "erro", err)
			d.AgentErr = "O agente de coleta não respondeu. Confira se o serviço oee-gateway está rodando (sudo -u oee oee-gateway diag)."
		} else {
			d.St = st
			fill(&d, st, now)
		}
	}
	s.render(w, http.StatusOK, statusTmpl, d)
}

func fill(d *statusData, st *localapi.Status, now time.Time) {
	d.Started = fmtTime(st.Agent.StartedAt)
	d.Config = "sem config da nuvem"
	if st.Agent.ConfigVersion > 0 {
		d.Config = fmt.Sprintf("versão %d", st.Agent.ConfigVersion)
	}
	if st.Agent.ConfigState != "" {
		d.Config += " (" + configStates[st.Agent.ConfigState] + ")"
	}

	c := cloudView{URL: st.Cloud.URL, LastOK: "nunca, desde que o agente iniciou"}
	if st.Cloud.LastOKAt != nil {
		c.LastOK = fmtTime(*st.Cloud.LastOKAt) + " (" + ago(now.Sub(*st.Cloud.LastOKAt)) + ")"
	}
	switch {
	case !st.Cloud.Registered:
		c.Label, c.Class = "Gateway não ativado (falta o enroll)", "alerta"
	case st.Cloud.Blocked:
		c.Label, c.Class = "Token recusado pela nuvem: refaça o enroll", "falha"
	case st.Cloud.LastOKAt != nil && now.Sub(*st.Cloud.LastOKAt) < cloudOnlineWithin:
		c.Label, c.Class = "Conectado", "ok"
	default:
		c.Label, c.Class = "Sem contato com a nuvem (os dados ficam guardados no gateway)", "falha"
	}
	if st.Cloud.LastError != "" && c.Class != "ok" {
		c.Error = st.Cloud.LastError
		if k := errorKinds[st.Cloud.LastErrorKind]; k != "" {
			c.Error = k + ": " + c.Error
		}
	}
	c.Clock = fmt.Sprintf("%+.1f s", float64(st.Cloud.ClockOffsetMS)/1000)
	d.Cloud = c

	q := queueView{Pending: st.Queue.Pending, Quarantined: st.Queue.Quarantined, Class: "ok", Error: st.Queue.Error}
	if st.Queue.OldestS != nil && *st.Queue.OldestS > 0 {
		q.Oldest = ago(time.Duration(*st.Queue.OldestS) * time.Second)
		if *st.Queue.OldestS > 15*60 {
			q.Class = "alerta"
		}
	}
	if q.Error != "" || q.Quarantined > 0 {
		q.Class = "falha"
	}
	d.Queue = q

	for _, dv := range st.Devices {
		v := deviceView{Name: orID(dv.Name, dv.ID), ID: dv.ID, Protocol: protocols[dv.Protocol], Errors: dv.Errors1m,
			LastOK: "—", Error: dv.LastError}
		if v.Protocol == "" {
			v.Protocol = dv.Protocol
		}
		v.Label, v.Class = deviceStates[dv.Status].label, deviceStates[dv.Status].class
		if v.Label == "" {
			v.Label, v.Class = dv.Status, "alerta"
		}
		if dv.LatencyMS != nil {
			v.Latency = fmt.Sprintf("%d ms", *dv.LatencyMS)
		}
		if t, err := time.Parse(time.RFC3339Nano, dv.LastOKAt); err == nil {
			v.LastOK = fmtTime(t)
		}
		d.Devices = append(d.Devices, v)
	}
	for _, m := range st.Machines {
		v := machineView{Name: orID(m.Name, m.ID), ID: m.ID, Product: m.Product, State: "sem leitura ainda", Class: "neutro"}
		if ms, ok := machineStates[m.State]; ok {
			v.State, v.Class = ms.label, ms.class
		} else if m.State != "" {
			v.State, v.Class = m.State, "neutro"
		}
		if t, err := time.Parse(time.RFC3339Nano, m.StateSince); err == nil {
			v.Since = fmtTime(t) + " (" + ago(now.Sub(t)) + ")"
		}
		if t, err := time.Parse(time.RFC3339Nano, m.At); err == nil {
			v.At = fmtTime(t)
		}
		if m.CounterTotal != nil {
			v.Counter = fmt.Sprintf("%d", *m.CounterTotal)
		}
		if m.FaultCode != nil {
			v.Fault = fmt.Sprintf("%d", *m.FaultCode)
		}
		d.Machines = append(d.Machines, v)
	}
}

type label struct{ label, class string }

var (
	deviceStates = map[string]label{
		"connected": {"Conectado", "ok"}, "degraded": {"Instável", "alerta"},
		"disconnected": {"Sem comunicação", "falha"}, "disabled": {"Desabilitado", "neutro"},
	}
	machineStates = map[string]label{
		"RUNNING": {"Produzindo", "ok"}, "STOPPED": {"Parada", "alerta"}, "FAULT": {"Em falha", "falha"},
		"SETUP": {"Em setup", "alerta"}, "NO_COMM": {"Sem comunicação", "falha"},
	}
	configStates = map[string]string{
		"applying": "aplicando", "observing": "em observação", "applied": "aplicada", "rejected": "recusada", "reverted": "revertida",
	}
	protocols  = map[string]string{"modbus-tcp": "Modbus TCP", "modbus-rtu": "Modbus RTU (RS-485)", "modbus-rtu-over-tcp": "RTU sobre TCP"}
	errorKinds = map[string]string{
		"dns": "DNS", "tls": "TLS/certificado", "proxy": "proxy", "timeout": "tempo esgotado", "conexao": "conexão",
		"http_4xx": "recusado pela nuvem", "http_5xx": "erro na nuvem", "buffer": "buffer local", "outro": "outro",
	}
)

func orID(name, id string) string {
	if name != "" {
		return name
	}
	return id
}

func fmtTime(t time.Time) string { return t.In(brt).Format("02/01 15:04:05") }

func ago(d time.Duration) string {
	switch {
	case d < 0:
		return "agora"
	case d < time.Minute:
		return fmt.Sprintf("há %d s", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("há %d min", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("há %d h %02d min", int(d.Hours()), int(d.Minutes())%60)
	}
	return fmt.Sprintf("há %d dias", int(d.Hours()/24))
}

func (s *Server) render(w http.ResponseWriter, status int, t *template.Template, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := t.Execute(w, data); err != nil {
		s.Log.Warn("página local: erro ao montar a página", "erro", err)
	}
}

const css = `<style>
:root{--fundo:#f6f7f9;--cartao:#fff;--texto:#1f2933;--suave:#52606d;--borda:#d9dee4;--ok:#1d7a46;--alerta:#9a6100;--falha:#b42318;--neutro:#52606d}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--fundo);color:var(--texto);font-size:15px;line-height:1.45}
header{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between;padding:.75rem 1rem;background:#12324f;color:#fff}
header h1{font-size:1.05rem;margin:0}header small{opacity:.8}header form{margin:0}
main{max-width:72rem;margin:0 auto;padding:1rem}section{background:var(--cartao);border:1px solid var(--borda);border-radius:8px;padding:1rem;margin-bottom:1rem}
h2{font-size:1rem;margin:0 0 .75rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:.35rem 1rem;margin:0}dt{color:var(--suave)}dd{margin:0;overflow-wrap:anywhere}
.grade{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}.grade section{margin:0}
.tabela{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:36rem}th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid var(--borda);vertical-align:top}th{color:var(--suave);font-weight:600;font-size:.85rem}
.selo{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.85rem;font-weight:600;border:1px solid currentColor}
.ok{color:var(--ok)}.alerta{color:var(--alerta)}.falha{color:var(--falha)}.neutro{color:var(--neutro)}
.aviso{border-left:4px solid var(--falha);background:#fff5f4}.erro{color:var(--falha);font-size:.9rem}.mudo{color:var(--suave);font-size:.85rem}
button{font:inherit;padding:.5rem 1rem;border-radius:6px;border:1px solid #12324f;background:#12324f;color:#fff;cursor:pointer}
header button{background:transparent;border-color:#fff;padding:.3rem .8rem}
input{font:inherit;padding:.5rem;border:1px solid var(--borda);border-radius:6px;width:100%}label{display:block;margin-bottom:.35rem;font-weight:600}
.login{max-width:24rem;margin:3rem auto}
@media (max-width:600px){main{padding:.75rem}dl{grid-template-columns:1fr}dt{margin-top:.35rem}}
</style>`

var loginTmpl = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Gateway OEE</title>` + css + `</head><body>
<header><h1>Gateway OEE Engemase <small>{{.Host}}</small></h1><small>agente {{.Version}}</small></header>
<main><section class="login">
<h2>Página local de comissionamento</h2>
{{if .NoPassword}}
<p>A senha local deste gateway ainda não foi definida. Não há como entrar pela página.</p>
<p class="mudo">Na bancada: <code>sudo oee-gateway localui passwd --generate</code>.</p>
{{else if .LockedUntil}}
<p class="erro">Muitas senhas erradas. Tente de novo depois das {{.LockedUntil}}.</p>
{{else}}
<form method="post" action="/entrar">
<label for="senha">Senha local (cartão lacrado do gateway)</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
{{if .Error}}<p class="erro" role="alert">{{.Error}}</p>{{end}}
<p><button type="submit">Entrar</button></p>
</form>
<p class="mudo">5 senhas erradas bloqueiam o login por 15 minutos.</p>
{{end}}
</section></main></body></html>`))

var statusTmpl = template.Must(template.New("status").Parse(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Status · Gateway OEE</title>` + css + `</head><body>
<header><h1>Gateway OEE Engemase <small>{{.Host}}</small></h1>
<form method="post" action="/sair"><button type="submit">Sair</button></form></header>
<main>
<p class="mudo">Atualizado em {{.Now}} (a página se atualiza a cada 15 s). Somente leitura: nada aqui altera os CLPs.</p>
{{if .AgentErr}}<section class="aviso"><h2>Agente</h2><p>{{.AgentErr}}</p></section>{{else}}
<div class="grade">
<section><h2>Nuvem</h2><dl>
<dt>Situação</dt><dd><span class="selo {{.Cloud.Class}}">{{.Cloud.Label}}</span></dd>
<dt>Último envio aceito</dt><dd>{{.Cloud.LastOK}}</dd>
{{if .Cloud.Error}}<dt>Último erro</dt><dd class="erro">{{.Cloud.Error}}</dd>{{end}}
<dt>Diferença do relógio</dt><dd>{{.Cloud.Clock}}</dd>
<dt>Endereço</dt><dd>{{.Cloud.URL}}</dd>
</dl></section>
<section><h2>Fila pendente</h2><dl>
<dt>Itens a enviar</dt><dd><span class="selo {{.Queue.Class}}">{{.Queue.Pending}}</span></dd>
<dt>Mais antigo</dt><dd>{{if .Queue.Oldest}}{{.Queue.Oldest}}{{else}}nada pendente{{end}}</dd>
<dt>Em quarentena</dt><dd>{{.Queue.Quarantined}}</dd>
{{if .Queue.Error}}<dt>Erro</dt><dd class="erro">{{.Queue.Error}}</dd>{{end}}
</dl></section>
<section><h2>Agente</h2><dl>
<dt>Versão</dt><dd>{{.St.Agent.Version}}</dd>
<dt>Iniciado em</dt><dd>{{.Started}}</dd>
<dt>Config</dt><dd>{{.Config}}</dd>
{{if .St.Agent.ConfigError}}<dt>Erro da config</dt><dd class="erro">{{.St.Agent.ConfigError}}</dd>{{end}}
</dl></section>
</div>
<section><h2>Conexões com os CLPs</h2>
{{if .Devices}}<div class="tabela"><table><thead><tr><th>Dispositivo</th><th>Protocolo</th><th>Situação</th><th>Latência</th><th>Erros/min</th><th>Última leitura boa</th><th>Último erro</th></tr></thead><tbody>
{{range .Devices}}<tr><td>{{.Name}}{{if ne .Name .ID}}<br><span class="mudo">{{.ID}}</span>{{end}}</td><td>{{.Protocol}}</td><td><span class="selo {{.Class}}">{{.Label}}</span></td><td>{{.Latency}}</td><td>{{.Errors}}</td><td>{{.LastOK}}</td><td class="erro">{{.Error}}</td></tr>
{{end}}</tbody></table></div>{{else}}<p class="mudo">Nenhum dispositivo na config (ou a coleta ainda não começou).</p>{{end}}
</section>
<section><h2>Últimas leituras</h2>
{{if .Machines}}<div class="tabela"><table><thead><tr><th>Máquina</th><th>Estado</th><th>Desde</th><th>Contador</th><th>Produto</th><th>Código de falha</th><th>Lida em</th></tr></thead><tbody>
{{range .Machines}}<tr><td>{{.Name}}{{if ne .Name .ID}}<br><span class="mudo">{{.ID}}</span>{{end}}</td><td><span class="selo {{.Class}}">{{.State}}</span></td><td>{{.Since}}</td><td>{{.Counter}}</td><td>{{.Product}}</td><td>{{.Fault}}</td><td>{{.At}}</td></tr>
{{end}}</tbody></table></div>{{else}}<p class="mudo">Nenhuma máquina na config.</p>{{end}}
</section>
{{end}}
</main></body></html>`))
