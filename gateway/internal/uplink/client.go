// Package uplink é o cliente HTTPS do agente para a API dos gateways
// (/api/gateway/v1): enroll, sync (gzip, Bearer, timeouts) e config, com erros
// classificados pela ação que o agente deve tomar (docs/04, "Erros e retentativas").
package uplink

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// Action é o que o agente faz diante de um erro.
type Action string

// Ações (packages/contracts/src/errors.ts).
const (
	ActionOK            Action = "ok"
	ActionIsolateItem   Action = "isolate_item"   // 400: bisseção até achar o item culpado
	ActionStopSending   Action = "stop_sending"   // 401: para de enviar, mantém o buffer
	ActionRefreshConfig Action = "refresh_config" // 409: baixa a config e tenta de novo
	ActionSplitBatch    Action = "split_batch"    // 413: divide o lote ao meio
	ActionRetryAfter    Action = "retry_after"    // 429: respeita Retry-After
	ActionBackoff       Action = "backoff"        // 5xx/rede: backoff exponencial com jitter
	ActionFixAndRetry   Action = "fix_and_retry"  // erro de operação manual (enroll)
)

// ActionForStatus mapeia um status HTTP para a ação.
func ActionForStatus(status int) Action {
	switch {
	case status >= 200 && status < 300:
		return ActionOK
	case status == 400:
		return ActionIsolateItem
	case status == 401:
		return ActionStopSending
	case status == 409:
		return ActionRefreshConfig
	case status == 413:
		return ActionSplitBatch
	case status == 429:
		return ActionRetryAfter
	case status >= 500:
		return ActionBackoff
	}
	return ActionFixAndRetry
}

// HTTPError é uma resposta de erro da API.
type HTTPError struct {
	Status     int
	Code       string // error.code do corpo (se houver)
	Message    string
	RetryAfter time.Duration // de Retry-After ou error.retry_after_s
	Issues     []contracts.ErrorIssue
}

func (e *HTTPError) Error() string {
	msg := e.Message
	if msg == "" {
		msg = http.StatusText(e.Status)
	}
	if e.Code != "" {
		return fmt.Sprintf("nuvem respondeu %d (%s): %s", e.Status, e.Code, msg)
	}
	return fmt.Sprintf("nuvem respondeu %d: %s", e.Status, msg)
}

// ProxyConnectError é a falha do túnel (CONNECT) no proxy: a recusa (Status
// diferente de 200, com a frase como o proxy mandou) ou uma resposta que nem é
// HTTP (Status 0 e Err com o erro do net/http: porta ou esquema do proxy errados).
// O transporte do Go devolve as duas num erro sem tipo, só com o texto (a frase do
// status, "malformed HTTP response"), igual a outros erros sem tipo do net/http
// que aparecem com ou sem proxy; por isso o cliente as tipa aqui, só quando houve
// CONNECT de verdade: a recusa pelo OnProxyConnectResponse (checkProxyConnect) e
// a resposta ilegível quando a requisição foi por um proxy (proxyReplyError).
type ProxyConnectError struct {
	Proxy  string // host:porta do proxy (sem usuário e senha)
	Status int    // código do status do CONNECT (ex.: 407); 0 = resposta ilegível
	Reason string // frase do status como o proxy mandou; pode ser vazia
	Err    error  // com Status 0: o erro do net/http ao ler a resposta
}

func (e *ProxyConnectError) Error() string {
	msg := "proxy"
	if e.Proxy != "" {
		msg += " " + e.Proxy
	}
	if e.Status == 0 {
		return msg + " respondeu ao CONNECT com algo que não é HTTP: " + fmt.Sprint(e.Err)
	}
	msg += " recusou o túnel (CONNECT): " + strconv.Itoa(e.Status)
	reason := e.Reason
	if reason == "" {
		reason = http.StatusText(e.Status)
	}
	if reason != "" {
		msg += " " + reason
	}
	return msg
}

func (e *ProxyConnectError) Unwrap() error { return e.Err }

// checkProxyConnect é o OnProxyConnectResponse do transporte: o transporte chama
// antes de conferir o 200, e o erro devolvido aqui chega ao chamador como está
// (dentro do url.Error).
func checkProxyConnect(_ context.Context, proxyURL *url.URL, _ *http.Request, res *http.Response) error {
	if res.StatusCode == http.StatusOK {
		return nil
	}
	e := &ProxyConnectError{Status: res.StatusCode}
	if proxyURL != nil {
		e.Proxy = proxyURL.Host
	}
	if _, reason, ok := strings.Cut(res.Status, " "); ok {
		e.Reason = strings.TrimSpace(reason)
	}
	return e
}

// withProxyCheck devolve uma cópia do cliente cujo transporte (*http.Transport)
// tipa a recusa do CONNECT (checkProxyConnect), depois do OnProxyConnectResponse
// que já houver. O cliente dado não muda; um transporte de outro tipo fica como
// está.
func withProxyCheck(hc *http.Client) *http.Client {
	rt := hc.Transport
	if rt == nil {
		rt = http.DefaultTransport
	}
	tr, ok := rt.(*http.Transport)
	if !ok {
		return hc
	}
	tr = tr.Clone()
	if prev := tr.OnProxyConnectResponse; prev != nil {
		tr.OnProxyConnectResponse = func(ctx context.Context, proxyURL *url.URL, req *http.Request, res *http.Response) error {
			if err := prev(ctx, proxyURL, req, res); err != nil {
				return err
			}
			return checkProxyConnect(ctx, proxyURL, req, res)
		}
	} else {
		tr.OnProxyConnectResponse = checkProxyConnect
	}
	out := *hc
	out.Transport = tr
	return &out
}

// Erros sentinela.
var (
	// ErrBodyTooLarge: o JSON passou de 1 MiB descompactado antes mesmo de enviar.
	ErrBodyTooLarge = errors.New("uplink: lote maior que 1 MiB")
	// ErrNotModified: GET /config respondeu 304.
	ErrNotModified = errors.New("uplink: config não mudou")
)

// ActionFor classifica qualquer erro do cliente. Erro de rede/timeout → backoff.
func ActionFor(err error) Action {
	if err == nil {
		return ActionOK
	}
	if errors.Is(err, ErrBodyTooLarge) {
		return ActionSplitBatch
	}
	var he *HTTPError
	if errors.As(err, &he) {
		return ActionForStatus(he.Status)
	}
	return ActionBackoff
}

// Options configura o cliente.
type Options struct {
	BaseURL      string        // ex.: https://oee.engemase.com.br
	Token        string        // Bearer (vazio no enroll)
	AgentVersion string        // para o User-Agent
	Timeout      time.Duration // limite total de cada requisição (padrão 30 s)
	ExtraCAFile  string        // PEM com CAs corporativas, somadas às do sistema
	// HTTPClient substitui o cliente montado aqui (testes). Se o transporte for um
	// *http.Transport, o New usa uma cópia dele com a recusa do CONNECT tipada
	// (ProxyConnectError), como no cliente montado aqui.
	HTTPClient *http.Client
}

// Client fala com a API dos gateways.
type Client struct {
	base string
	ua   string
	http *http.Client

	mu    sync.RWMutex
	token string
}

// New monta o cliente: proxy por HTTPS_PROXY/NO_PROXY (falha do CONNECT como
// ProxyConnectError), CAs do sistema + extras, timeouts curtos de conexão e TLS 1.2+.
func New(o Options) (*Client, error) {
	if o.BaseURL == "" {
		return nil, errors.New("uplink: URL da nuvem vazia")
	}
	if o.Timeout <= 0 {
		o.Timeout = 30 * time.Second
	}
	if o.AgentVersion == "" {
		o.AgentVersion = "0.0.0"
	}
	c := &Client{
		base:  strings.TrimRight(o.BaseURL, "/"),
		ua:    fmt.Sprintf("oee-gateway/%s (%s; %s)", o.AgentVersion, runtime.GOOS, runtime.GOARCH),
		token: o.Token,
	}
	if o.HTTPClient != nil {
		c.http = withProxyCheck(o.HTTPClient)
	} else {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if o.ExtraCAFile != "" {
			pool, err := x509.SystemCertPool()
			if err != nil || pool == nil {
				pool = x509.NewCertPool()
			}
			pem, err := os.ReadFile(o.ExtraCAFile)
			if err != nil {
				return nil, fmt.Errorf("uplink: lendo CAs extras: %w", err)
			}
			if !pool.AppendCertsFromPEM(pem) {
				return nil, fmt.Errorf("uplink: nenhum certificado válido em %s", o.ExtraCAFile)
			}
			tlsCfg.RootCAs = pool
		}
		tr := &http.Transport{
			Proxy:                  http.ProxyFromEnvironment,
			OnProxyConnectResponse: checkProxyConnect,
			DialContext:            (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSClientConfig:        tlsCfg,
			TLSHandshakeTimeout:    10 * time.Second,
			ResponseHeaderTimeout:  o.Timeout,
			IdleConnTimeout:        90 * time.Second,
			MaxIdleConns:           2,
			ForceAttemptHTTP2:      true,
		}
		c.http = &http.Client{Transport: tr, Timeout: o.Timeout}
	}
	return c, nil
}

// SetToken troca o token (rotação ou novo enroll).
func (c *Client) SetToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = token
}

func (c *Client) bearer() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token
}

// do executa a requisição e tipa a resposta ilegível do proxy ao CONNECT
// (proxyReplyError).
func (c *Client) do(r *http.Request) (*http.Response, error) {
	res, err := c.http.Do(r)
	if err != nil {
		return nil, c.proxyReplyError(r, err)
	}
	return res, nil
}

// proxyReplyError troca por ProxyConnectError (Status 0) o "malformed HTTP ..."
// sem tipo de uma requisição HTTPS que foi por um proxy HTTP: é o transporte lendo
// a resposta ao CONNECT, que ele devolve como está. Depois do túnel aberto, a mesma
// falha na resposta da nuvem chega decorada ("net/http: HTTP/1.x transport
// connection broken: ...") e fica como está; sem proxy, decorada ou crua (resposta
// antes de qualquer byte da requisição), também.
func (c *Client) proxyReplyError(r *http.Request, err error) error {
	var ue *url.Error
	if r.URL.Scheme != "https" || !errors.As(err, &ue) || ue.Err == nil ||
		!strings.HasPrefix(ue.Err.Error(), "malformed HTTP ") {
		return err
	}
	tr, ok := c.http.Transport.(*http.Transport)
	if !ok || tr.Proxy == nil {
		return err
	}
	proxy, perr := tr.Proxy(r)
	if perr != nil || proxy == nil || (proxy.Scheme != "http" && proxy.Scheme != "https") {
		return err // sem proxy, ou SOCKS (sem CONNECT)
	}
	return &url.Error{Op: ue.Op, URL: ue.URL, Err: &ProxyConnectError{Proxy: proxy.Host, Err: ue.Err}}
}

// Sync envia um /sync.
func (c *Client) Sync(ctx context.Context, req *contracts.SyncRequest) (*contracts.SyncResponse, error) {
	var resp contracts.SyncResponse
	if err := c.postJSON(ctx, contracts.RouteSync, req, &resp, true); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Enroll troca o código de ativação pela credencial (sem Bearer).
func (c *Client) Enroll(ctx context.Context, req *contracts.EnrollRequest) (*contracts.EnrollResponse, error) {
	var resp contracts.EnrollResponse
	if err := c.postJSON(ctx, contracts.RouteEnroll, req, &resp, false); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FetchConfig baixa a config completa. Com etag, 304 devolve ErrNotModified.
func (c *Client) FetchConfig(ctx context.Context, etag string) (body []byte, newETag string, err error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+contracts.RouteConfig, nil)
	if err != nil {
		return nil, "", err
	}
	c.setHeaders(r, true)
	r.Header.Set("Accept-Encoding", "gzip")
	if etag != "" {
		r.Header.Set("If-None-Match", etag)
	}
	res, err := c.do(r)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotModified {
		return nil, etag, ErrNotModified
	}
	body, err = readBody(res, 8<<20)
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", parseError(res, body)
	}
	return body, res.Header.Get("ETag"), nil
}

func (c *Client) setHeaders(r *http.Request, auth bool) {
	r.Header.Set("User-Agent", c.ua)
	r.Header.Set("Accept", "application/json")
	if auth {
		if tok := c.bearer(); tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
	}
}

func (c *Client) postJSON(ctx context.Context, route string, in, out any, auth bool) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("uplink: serializando: %w", err)
	}
	if len(raw) > contracts.MaxSyncBodyBytes {
		return fmt.Errorf("%w (%d bytes)", ErrBodyTooLarge, len(raw))
	}
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	if _, err := zw.Write(raw); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+route, &gz)
	if err != nil {
		return err
	}
	c.setHeaders(r, auth)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Content-Encoding", "gzip")
	r.Header.Set("Accept-Encoding", "gzip")

	res, err := c.do(r)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := readBody(res, 4<<20)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return parseError(res, body)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("uplink: resposta %d inválida: %w", res.StatusCode, err)
	}
	return nil
}

// readBody lê a resposta (descompactando gzip se o servidor mandou) com limite.
func readBody(res *http.Response, limit int64) ([]byte, error) {
	var r io.Reader = res.Body
	if strings.EqualFold(res.Header.Get("Content-Encoding"), "gzip") {
		zr, err := gzip.NewReader(res.Body)
		if err != nil {
			return nil, fmt.Errorf("uplink: gzip inválido na resposta: %w", err)
		}
		defer zr.Close()
		r = zr
	}
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("uplink: resposta maior que %d bytes", limit)
	}
	return b, nil
}

func parseError(res *http.Response, body []byte) error {
	he := &HTTPError{Status: res.StatusCode}
	var er contracts.ErrorResponse
	if json.Unmarshal(body, &er) == nil && er.Error.Code != "" {
		he.Code, he.Message, he.Issues = er.Error.Code, er.Error.Message, er.Error.Issues
		if er.Error.RetryAfterS != nil {
			he.RetryAfter = time.Duration(*er.Error.RetryAfterS) * time.Second
		}
	}
	if ra := res.Header.Get("Retry-After"); ra != "" {
		if s, err := strconv.Atoi(strings.TrimSpace(ra)); err == nil && s >= 0 {
			he.RetryAfter = time.Duration(s) * time.Second
		} else if t, err := http.ParseTime(ra); err == nil {
			if d := time.Until(t); d > 0 {
				he.RetryAfter = d
			}
		}
	}
	return he
}
