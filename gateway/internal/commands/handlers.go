package commands

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
)

// Prazos de execução (COMMAND_EXEC_TIMEOUT_S do contrato).
const (
	TagReadTimeout      = 5 * time.Second
	DeviceTestTimeout   = 10 * time.Second
	ConfigReloadTimeout = 60 * time.Second
	AgentRestartTimeout = 10 * time.Second
)

// busPauseMax é a pausa máxima de um barramento no device.test com outros
// parâmetros seriais (docs/rascunhos/gateway-software.md §3.8).
const busPauseMax = 5 * time.Second

// Limite de taxa do device.test em endereço fora da config (docs/16 §5).
const (
	outsideTestsMax    = 10
	outsideTestsWindow = 10 * time.Minute
)

// Tipos de comando do contrato v1 que o agente do MVP executa.
const (
	TypeTagRead      = "tag.read"
	TypeDeviceTest   = "device.test"
	TypeConfigReload = "config.reload"
	TypeAgentRestart = "agent.restart"
)

// Resultados de sucesso (packages/contracts/src/commands.ts).
type (
	// TagReadResult é o resultado de tag.read.
	TagReadResult struct {
		Value   any      `json:"value"`
		Raw     []uint16 `json:"raw,omitempty"`
		Quality string   `json:"quality"`
		ReadMS  int64    `json:"read_ms"`
	}
	// DeviceTestResult é o resultado de device.test.
	DeviceTestResult struct {
		LatencyMS int64        `json:"latency_ms"`
		Probe     *ProbeResult `json:"probe,omitempty"`
	}
	// ProbeResult é a leitura de teste do device.test (bits como 0/1).
	ProbeResult struct {
		Raw    []uint16 `json:"raw"`
		ReadMS int64    `json:"read_ms"`
	}
	// ConfigReloadResult é o resultado de config.reload.
	ConfigReloadResult struct {
		Version int    `json:"version"`
		Outcome string `json:"outcome"` // applied | unchanged
	}
	// AgentRestartResult é o resultado de agent.restart.
	AgentRestartResult struct {
		RestartAt string `json:"restart_at"`
	}
)

// Deps é o que os handlers do MVP usam do agente.
type Deps struct {
	// Config devolve a config aplicada (nil: nenhuma ainda).
	Config func() *config.GatewayConfig
	// Local é a config local (portas seriais do perfil de hardware).
	Local *config.Local
	// Modbus é o caminho das leituras (pollers em execução ou conexão avulsa).
	Modbus *Access
	// AllowTarget confere um IP fora da config no device.test (padrão OTSubnet).
	AllowTarget func(ip net.IP) error
	// ReloadConfig baixa e aplica a config na hora (config.reload). nil = unsupported.
	ReloadConfig func(ctx context.Context) (ConfigReloadResult, error)
	// ScheduleRestart agenda o reinício do agente (agent.restart). nil = unsupported.
	ScheduleRestart func(id string, delay time.Duration, reason string) error
	// Now é o relógio corrigido pelo server_time (padrão time.Now).
	Now func() time.Time
	// Log recebe a auditoria dos testes fora da config (nil = slog.Default()).
	Log *slog.Logger
}

// RegisterMVP registra os handlers de tag.read, device.test, config.reload e
// agent.restart.
func RegisterMVP(x *Executor, d Deps) {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.Log == nil {
		d.Log = slog.Default()
	}
	if d.AllowTarget == nil {
		d.AllowTarget = OTSubnet
	}
	if d.Modbus == nil {
		d.Modbus = &Access{}
	}
	h := &handlers{Deps: d}
	x.Register(TypeTagRead, TagReadTimeout, h.tagRead)
	x.Register(TypeDeviceTest, DeviceTestTimeout, h.deviceTest)
	if d.ReloadConfig != nil {
		x.Register(TypeConfigReload, ConfigReloadTimeout, h.configReload)
	}
	if d.ScheduleRestart != nil {
		x.Register(TypeAgentRestart, AgentRestartTimeout, h.agentRestart)
	}
}

type handlers struct {
	Deps
	mu      sync.Mutex
	outside []time.Time // device.test fora da config na janela do limite
}

func (h *handlers) config() *config.GatewayConfig {
	if h.Config == nil {
		return nil
	}
	return h.Config()
}

func findDevice(cfg *config.GatewayConfig, id string) *config.Device {
	if cfg == nil {
		return nil
	}
	for i := range cfg.Devices {
		if cfg.Devices[i].ID == id {
			return &cfg.Devices[i]
		}
	}
	return nil
}

func findBus(cfg *config.GatewayConfig, id string) *config.SerialBus {
	if cfg == nil {
		return nil
	}
	for i := range cfg.SerialBuses {
		if cfg.SerialBuses[i].ID == id {
			return &cfg.SerialBuses[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// tag.read
// ---------------------------------------------------------------------------

func (h *handlers) tagRead(ctx context.Context, c contracts.Command) (any, error) {
	p, err := ParseTagRead(c.Payload)
	if err != nil {
		return nil, err
	}
	cfg := h.config()
	dev := findDevice(cfg, p.DeviceID)
	if dev == nil {
		return nil, Fail(CodeDeviceNotFound, "Dispositivo %s não existe na config aplicada.", p.DeviceID)
	}
	tag := config.Tag{Address: p.Address, Type: p.Type, WordOrder: p.WordOrder, Scale: p.Scale}
	spec := tag.Spec()
	var (
		raw modbus.Raw
		rtt time.Duration
	)
	if pp := h.Modbus.byDevice(dev.ID); pp != nil {
		raw, rtt, err = pp.Read(ctx, dev.UnitID(), spec.Span())
	} else {
		// Dispositivo sem poller (desabilitado): pelo dono da linha ou conexão avulsa.
		target, terr := TargetFor(dev.Protocol, dev.Params, findBus(cfg, dev.Params.Bus), h.Local)
		if terr != nil {
			return nil, terr
		}
		raw, rtt, err = h.Modbus.Read(ctx, target, dev.UnitID(), spec.Span())
	}
	if err != nil {
		return nil, modbusError(err)
	}
	v, err := raw.Decode(spec)
	if err != nil {
		return nil, Fail(CodeDecodeError, "%v", err)
	}
	res := TagReadResult{Quality: "good", ReadMS: rtt.Milliseconds()}
	if spec.Area.IsBit() {
		res.Raw = []uint16{uint16(v.Raw())}
	} else {
		res.Raw = append([]uint16(nil), raw.Regs[int(spec.Offset)-int(raw.Span.Start):][:spec.Type.Registers()]...)
	}
	switch mul, add := tag.ScaleFactors(); {
	case spec.Type == modbus.Bool:
		res.Value = v.Bool()
	case mul == 1 && add == 0 && spec.Type.IsInteger():
		res.Value = v.Int64()
	case mul == 1 && add == 0:
		f, _ := strconv.ParseFloat(v.String(), 64) // float32 sem os dígitos espúrios do float64
		res.Value = f
	default:
		res.Value = v.Scaled(mul, add)
	}
	if f, ok := res.Value.(float64); ok && (math.IsNaN(f) || math.IsInf(f, 0)) {
		return nil, Fail(CodeDecodeError, "O valor lido não é um número finito (%v).", f)
	}
	return res, nil
}

// ---------------------------------------------------------------------------
// device.test
// ---------------------------------------------------------------------------

// minimalProbe é a transação do teste sem leitura pedida em RTU ou pelo dono do
// transporte: qualquer resposta, inclusive exceção, mostra que o escravo existe.
var minimalProbe = modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 1}

func (h *handlers) deviceTest(ctx context.Context, c contracts.Command) (any, error) {
	p, err := ParseDeviceTest(c.Payload)
	if err != nil {
		return nil, err
	}
	cfg := h.config()
	conn := p.Connection
	var bus *config.SerialBus
	if conn.Protocol == config.ProtocolRTU {
		bus = p.SerialBus
		if bus == nil {
			bus = findBus(cfg, conn.Params.Bus)
		}
	}
	target, err := TargetFor(conn.Protocol, conn.Params, bus, h.Local)
	if err != nil {
		return nil, err
	}
	key := poller.TransportKey(target)
	if target.Transport != modbus.TransportRTU && !h.knownEndpoint(cfg, key) {
		if err := h.allowOutside(c, conn.Params.Host, target.Address); err != nil {
			return nil, err
		}
	}
	owner := h.Modbus.owner(key)
	paused := false
	if owner != nil && target.Transport == modbus.TransportRTU && !poller.SameSerial(owner.Target(), target) {
		if !p.AllowBusPause {
			return nil, Fail(CodeBusPauseRequired, "O barramento %s está em uso com outros parâmetros seriais: o teste exige allow_bus_pause.", conn.Params.Bus)
		}
		paused = true
	}
	unit := uint8(*conn.Params.UnitID)

	if p.Probe == nil && owner == nil && target.Transport == modbus.TransportTCP {
		took, err := h.Modbus.Connect(ctx, target)
		if err != nil {
			return nil, modbusError(err)
		}
		return DeviceTestResult{LatencyMS: took.Milliseconds()}, nil
	}
	span := minimalProbe
	if p.Probe != nil {
		span = p.Probe.Span()
	}
	var (
		raw modbus.Raw
		rtt time.Duration
	)
	if paused {
		pctx, cancel := context.WithTimeout(ctx, busPauseMax)
		raw, rtt, err = h.Modbus.ReadPaused(pctx, target, unit, span)
		cancel()
	} else {
		raw, rtt, err = h.Modbus.Read(ctx, target, unit, span)
	}
	if err != nil {
		var exc *modbus.ExceptionError
		if p.Probe == nil && errors.As(modbus.Classify(err), &exc) && exc.Code != 10 && exc.Code != 11 {
			// Sem leitura pedida, a exceção do escravo prova a conexão (10 e 11 são do
			// gateway Modbus, sem o escravo atrás).
			return DeviceTestResult{LatencyMS: rtt.Milliseconds()}, nil
		}
		return nil, modbusError(err)
	}
	res := DeviceTestResult{LatencyMS: rtt.Milliseconds()}
	if p.Probe != nil {
		pr := &ProbeResult{ReadMS: rtt.Milliseconds(), Raw: []uint16{}}
		if span.Area.IsBit() {
			for _, b := range raw.Bits[:span.Count] {
				pr.Raw = append(pr.Raw, map[bool]uint16{false: 0, true: 1}[b])
			}
		} else {
			pr.Raw = append(pr.Raw, raw.Regs...)
		}
		res.Probe = pr
	}
	return res, nil
}

// knownEndpoint diz se algum dispositivo da config aplicada usa a mesma linha.
func (h *handlers) knownEndpoint(cfg *config.GatewayConfig, key string) bool {
	if cfg == nil {
		return false
	}
	for i := range cfg.Devices {
		d := &cfg.Devices[i]
		if d.Protocol == config.ProtocolRTU {
			continue
		}
		t, err := TargetFor(d.Protocol, d.Params, nil, h.Local)
		if err == nil && poller.TransportKey(t) == key {
			return true
		}
	}
	return false
}

// allowOutside aplica a política do device.test num endereço fora da config: só IP
// da sub-rede OT, com limite de taxa e auditoria no log. A liberação temporária no
// firewall (5 min) é do oee-helper, quando ele existir; até lá a regra provisória da
// Fase 0 já deixa o agente abrir TCP para faixas privadas (docs/16 §5).
func (h *handlers) allowOutside(c contracts.Command, host, addr string) error {
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil {
		h.Log.Warn("device.test recusado: fora da config e sem IPv4", "id", c.ID, "alvo", addr)
		return Fail(CodeTargetNotAllowed, "Endereço fora da config: só IPv4 da sub-rede OT (não nome de host).")
	}
	if err := h.AllowTarget(ip); err != nil {
		h.Log.Warn("device.test recusado: fora da sub-rede OT", "id", c.ID, "alvo", addr, "motivo", err.Error())
		return Fail(CodeTargetNotAllowed, "%v", err)
	}
	now := time.Now()
	h.mu.Lock()
	kept := h.outside[:0]
	for _, t := range h.outside {
		if now.Sub(t) < outsideTestsWindow {
			kept = append(kept, t)
		}
	}
	h.outside = kept
	over := len(h.outside) >= outsideTestsMax
	if !over {
		h.outside = append(h.outside, now)
	}
	h.mu.Unlock()
	if over {
		h.Log.Warn("device.test recusado: limite de testes fora da config", "id", c.ID, "alvo", addr)
		return Fail(CodeTargetNotAllowed, "Limite de %d testes em endereços fora da config a cada %s.", outsideTestsMax, outsideTestsWindow)
	}
	h.Log.Info("device.test em endereço fora da config", "id", c.ID, "alvo", addr)
	return nil
}

// OTSubnet é a política padrão do device.test fora da config: IPv4 privado ou
// link-local, numa sub-rede ligada a uma interface do gateway que não é a da rota
// padrão (a IT). Loopback nunca.
func OTSubnet(ip net.IP) error {
	ip4 := ip.To4()
	if ip4 == nil || !(ip4.IsPrivate() || ip4.IsLinkLocalUnicast()) {
		return errors.New("endereço fora das faixas privadas e link-local da rede OT")
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return errors.New("não foi possível ler as interfaces de rede")
	}
	it := defaultRouteIfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 || ifc.Flags&net.FlagUp == 0 || it[ifc.Name] {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && n.Contains(ip4) {
				return nil
			}
		}
	}
	return errors.New("endereço fora das sub-redes OT do gateway")
}

// defaultRouteIfaces lê as interfaces com rota padrão IPv4 (/proc/net/route).
func defaultRouteIfaces() map[string]bool {
	out := map[string]bool{}
	f, err := os.Open("/proc/net/route")
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) > 2 && fields[1] == "00000000" {
			out[fields[0]] = true
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// config.reload e agent.restart
// ---------------------------------------------------------------------------

func (h *handlers) configReload(ctx context.Context, c contracts.Command) (any, error) {
	res, err := h.ReloadConfig(ctx)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (h *handlers) agentRestart(_ context.Context, c contracts.Command) (any, error) {
	p, err := ParseAgentRestart(c.Payload)
	if err != nil {
		return nil, err
	}
	delay := time.Duration(0)
	if p.DelayS != nil {
		delay = time.Duration(*p.DelayS) * time.Second
	}
	if err := h.ScheduleRestart(c.ID, delay, p.Reason); err != nil {
		return nil, err
	}
	return AgentRestartResult{RestartAt: contracts.FormatTime(h.Now().Add(delay))}, nil
}
