package config

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// Issue é um problema de validação. Path usa pontos e índices base 0 (como o
// manifest.json das fixtures, ex.: "devices.0.tags.3.word_order"). Rule é o id da
// regra semântica do contrato (packages/contracts/src/rules.ts); vazio para
// problemas de estrutura (o que o JSON Schema já pegaria).
type Issue struct {
	Path    string
	Rule    string
	Message string
}

func (i Issue) String() string {
	if i.Rule != "" {
		return fmt.Sprintf("%s: %s [%s]", i.Path, i.Message, i.Rule)
	}
	return fmt.Sprintf("%s: %s", i.Path, i.Message)
}

// ValidationError junta todos os problemas de uma config.
type ValidationError struct {
	Issues []Issue
}

func (e *ValidationError) Error() string {
	const show = 5
	var b strings.Builder
	fmt.Fprintf(&b, "config inválida (%d problema(s))", len(e.Issues))
	for i, is := range e.Issues {
		if i == show {
			fmt.Fprintf(&b, "; e mais %d", len(e.Issues)-show)
			break
		}
		b.WriteString("; ")
		b.WriteString(is.String())
	}
	return b.String()
}

// Regras semânticas (mesmos ids do contrato).
const (
	RuleAddressBitArea      = "address.bit_area"
	RuleAddressRegisterBool = "address.register_bool_bit"
	RuleAddressBitOnlyBool  = "address.bit_only_bool"
	RuleAddressWordOrder    = "address.word_order"
	RuleAddressRange        = "address.range"
	RuleBlockRange          = "block.range"
	RuleBlockOverlap        = "block.overlap"
	RuleTagBlockPartial     = "tag.block_partial"
	RuleTagPollSource       = "tag.poll_source"
	RuleTagMachineRef       = "tag.machine_ref"
	RuleTagMachineRequired  = "tag.machine_required"
	RuleTagRoleType         = "tag.role_type"
	RuleTagRoleUnique       = "tag.role_unique"
	RuleTagSamplingRole     = "tag.sampling_role"
	RuleTagSamplingInterval = "tag.sampling_interval"
	RulePollRTUMin          = "poll.rtu_min"
	RuleIDsUnique           = "ids.unique"
	RuleBusRef              = "bus.ref"
	RuleBusPortUnique       = "bus.port_unique"
	RuleBusUnitUnique       = "bus.unit_unique"
	RuleTCPEndpointUnique   = "tcp.endpoint_unique"
	RuleLimitsTags          = "limits.tags"
	RuleMachineModeRoles    = "machine.mode_roles"
	RuleMachineCommLoss     = "machine.comm_loss"
	RuleMachineHeartbeat    = "machine.heartbeat"
	RuleMachineStateMap     = "machine.state_map"
)

var (
	uuidRe      = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)
	hostnameRe  = regexp.MustCompile(`^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`)
	ipv4Re      = regexp.MustCompile(`^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$`)
	serialRe    = regexp.MustCompile(`^(?:/dev/[A-Za-z0-9._/-]+|[a-z][a-z0-9-]{0,31})$`)
	stateKeyRe  = regexp.MustCompile(`^(?:0|-?[1-9]\d{0,9})$`)
	validBauds  = map[int]bool{1200: true, 2400: true, 4800: true, 9600: true, 19200: true, 38400: true, 57600: true, 115200: true}
	plcStates   = map[string]bool{"RUNNING": true, "STOPPED": true, "FAULT": true, "SETUP": true}
	validRoles  = map[string]bool{RoleStateRunning: true, RoleStateFault: true, RoleStateCode: true, RoleFaultCode: true, RoleCountTotal: true, RoleCountGood: true, RoleCountReject: true, RoleProductCode: true, RoleSpeedActual: true, RoleHeartbeat: true, RoleCustom: true}
	requiredFor = map[string]string{ModeSignals: RoleStateRunning, ModeStateCode: RoleStateCode, ModeCountDerived: RoleCountTotal}
)

// IsUUID confere o formato de id de entidade do contrato.
func IsUUID(s string) bool { return uuidRe.MatchString(s) }

// IsCounterRole indica papéis de contador.
func IsCounterRole(role string) bool {
	return role == RoleCountTotal || role == RoleCountGood || role == RoleCountReject
}

// IsStateOrCounterRole indica papéis que entram no cálculo de NO_COMM.
func IsStateOrCounterRole(role string) bool {
	return strings.HasPrefix(role, "state.") || strings.HasPrefix(role, "count.")
}

// roleAllows confere o tipo aceito por papel.
func roleAllows(role string, t modbus.DataType) bool {
	switch role {
	case RoleStateRunning, RoleStateFault:
		return t == modbus.Bool
	case RoleStateCode, RoleFaultCode, RoleCountTotal, RoleCountGood, RoleCountReject, RoleProductCode, RoleHeartbeat:
		return t.IsInteger()
	case RoleSpeedActual:
		return t != modbus.Bool
	case RoleCustom:
		return true
	}
	return false
}

type validator struct{ issues []Issue }

func (v *validator) add(rule, msg string, path ...any) {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmt.Sprint(p)
	}
	v.issues = append(v.issues, Issue{Path: strings.Join(parts, "."), Rule: rule, Message: msg})
}

// schema registra um problema de estrutura (sem regra semântica).
func (v *validator) schema(msg string, path ...any) { v.add("", msg, path...) }

func (v *validator) uuid(s string, path ...any) {
	if !IsUUID(s) {
		v.schema("id deve ser um UUID (a nuvem gera UUIDv7)", path...)
	}
}

func (v *validator) intRange(n, lo, hi int, path ...any) {
	if n < lo || n > hi {
		v.schema(fmt.Sprintf("valor %d fora da faixa %d–%d", n, lo, hi), path...)
	}
}

func (v *validator) text(s string, maxLen int, path ...any) {
	if len([]rune(s)) > maxLen {
		v.schema(fmt.Sprintf("texto com mais de %d caracteres", maxLen), path...)
	}
}

func (v *validator) utc(s string, path ...any) {
	if _, err := time.Parse(time.RFC3339Nano, s); err != nil || !strings.HasSuffix(s, "Z") {
		v.schema("timestamp inválido: use ISO 8601 em UTC com 'Z'", path...)
	}
}

// Validate confere a estrutura (o que o JSON Schema tolerante confere) e todas as
// regras semânticas do contrato para a config.
func (c *GatewayConfig) Validate() error {
	v := &validator{}
	c.validateStructure(v)
	c.validateSemantics(v)
	if len(v.issues) > 0 {
		return &ValidationError{Issues: v.issues}
	}
	return nil
}

func (c *GatewayConfig) validateStructure(v *validator) {
	if c.ConfigVersion < 1 {
		v.schema("config_version deve ser ≥ 1", "config_version")
	}
	if c.GatewayID != "" {
		v.uuid(c.GatewayID, "gateway_id")
	}
	if c.GeneratedAt != "" {
		v.utc(c.GeneratedAt, "generated_at")
	}
	if len(c.SerialBuses) > MaxSerialBuses {
		v.schema(fmt.Sprintf("máximo de %d barramentos", MaxSerialBuses), "serial_buses")
	}
	if len(c.Devices) > MaxDevices {
		v.schema(fmt.Sprintf("máximo de %d dispositivos", MaxDevices), "devices")
	}
	if len(c.Machines) > MaxMachines {
		v.schema(fmt.Sprintf("máximo de %d máquinas", MaxMachines), "machines")
	}

	for i, b := range c.SerialBuses {
		v.uuid(b.ID, "serial_buses", i, "id")
		v.text(b.Name, 120, "serial_buses", i, "name")
		if len(b.Port) > 64 || !serialRe.MatchString(b.Port) {
			v.schema("porta serial inválida: use um nome lógico (rs485-1) ou /dev/...", "serial_buses", i, "port")
		}
		if !validBauds[b.Baud] {
			v.schema(fmt.Sprintf("velocidade %d não suportada", b.Baud), "serial_buses", i, "baud")
		}
		if b.Parity != "N" && b.Parity != "E" && b.Parity != "O" {
			v.schema("paridade deve ser N, E ou O", "serial_buses", i, "parity")
		}
		if b.DataBits != 8 {
			v.schema("Modbus RTU usa sempre 8 bits de dados", "serial_buses", i, "data_bits")
		}
		if b.StopBits != 1 && b.StopBits != 2 {
			v.schema("stop_bits deve ser 1 ou 2", "serial_buses", i, "stop_bits")
		}
	}

	for d := range c.Devices {
		c.Devices[d].validateStructure(v, d)
	}

	for m, mc := range c.Machines {
		v.uuid(mc.ID, "machines", m, "id")
		v.text(mc.Name, 120, "machines", m, "name")
		r := mc.StateRules
		p := []any{"machines", m, "state_rules"}
		switch r.Mode {
		case ModeSignals:
		case ModeStateCode:
			keys := make([]string, 0, len(r.Map))
			for k := range r.Map {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				if !stateKeyRe.MatchString(k) {
					v.schema("código de estado deve ser um inteiro", append(p, "map", k)...)
				}
				if !plcStates[r.Map[k]] {
					v.schema(fmt.Sprintf("estado %q inválido no mapa (NO_COMM é só do gateway)", r.Map[k]), append(p, "map", k)...)
				}
			}
			if r.DefaultState != "" && !plcStates[r.DefaultState] {
				v.schema("default_state inválido", append(p, "default_state")...)
			}
		case ModeCountDerived:
			if r.IdealCycleS == nil || *r.IdealCycleS <= 0 || *r.IdealCycleS > 86400 {
				v.schema("ideal_cycle_s é obrigatório (0 < s ≤ 86400) no modo count_derived", append(p, "ideal_cycle_s")...)
			}
			if r.IdleAfterCycles != nil && (*r.IdleAfterCycles < 1 || *r.IdleAfterCycles > 1000) {
				v.schema("idle_after_cycles fora da faixa 1–1000", append(p, "idle_after_cycles")...)
			}
		default:
			v.schema(fmt.Sprintf("modo %q inválido (signals, state_code ou count_derived)", r.Mode), append(p, "mode")...)
		}
		if r.CommLossAfterS != nil {
			v.intRange(*r.CommLossAfterS, 1, 3600, append(p, "comm_loss_after_s")...)
		}
		if r.DebounceS != nil && (*r.DebounceS < 0 || *r.DebounceS > 60) {
			v.schema("debounce_s fora da faixa 0–60", append(p, "debounce_s")...)
		}
		if r.HeartbeatTimeoutS != nil {
			v.intRange(*r.HeartbeatTimeoutS, 1, 3600, append(p, "heartbeat_timeout_s")...)
		}
		if mc.MaxRatePerS != nil && (*mc.MaxRatePerS <= 0 || *mc.MaxRatePerS > 100_000) {
			v.schema("max_rate_per_s fora da faixa (0, 100000]", "machines", m, "max_rate_per_s")
		}
	}

	v.intRange(c.Uplink.SyncIntervalS, 1, 300, "uplink", "sync_interval_s")
	v.intRange(c.Uplink.MaxBatchItems, 1, DefaultMaxBatchItems, "uplink", "max_batch_items")
	if c.Uplink.MaxBatchBytes != 0 {
		v.intRange(c.Uplink.MaxBatchBytes, 1024, DefaultMaxBatchBytes, "uplink", "max_batch_bytes")
	}
}

func (d *Device) validateStructure(v *validator, i int) {
	p := func(rest ...any) []any { return append([]any{"devices", i}, rest...) }
	v.uuid(d.ID, p("id")...)
	v.text(d.Name, 120, p("name")...)

	host := func() {
		h := d.Params.Host
		if h == "" || !(ipv4Re.MatchString(h) || (len(h) <= 253 && hostnameRe.MatchString(h))) {
			v.schema("host deve ser um IPv4 ou nome de host", p("params", "host")...)
		}
		v.intRange(d.Params.Port, 1, 65535, p("params", "port")...)
	}
	unit := func(lo, hi int) {
		if d.Params.UnitID == nil {
			v.schema("unit_id é obrigatório", p("params", "unit_id")...)
			return
		}
		v.intRange(*d.Params.UnitID, lo, hi, p("params", "unit_id")...)
	}
	switch d.Protocol {
	case ProtocolTCP:
		host()
		unit(0, 255)
	case ProtocolRTUOverTCP:
		host()
		unit(1, 247)
	case ProtocolRTU:
		v.uuid(d.Params.Bus, p("params", "bus")...)
		unit(1, 247)
		if d.Params.TurnaroundMS != nil {
			v.intRange(*d.Params.TurnaroundMS, 0, 1000, p("params", "turnaround_ms")...)
		}
	default:
		v.schema(fmt.Sprintf("protocolo %q não suportado (modbus-tcp, modbus-rtu ou modbus-rtu-over-tcp)", d.Protocol), p("protocol")...)
	}
	if d.Params.TimeoutMS != 0 {
		v.intRange(d.Params.TimeoutMS, 50, 10000, p("params", "timeout_ms")...)
	}

	if len(d.Blocks) > 256 {
		v.schema("máximo de 256 blocos por dispositivo", p("blocks")...)
	}
	for b, blk := range d.Blocks {
		area, err := modbus.ParseArea(blk.Area)
		if err != nil || blk.Area != area.String() {
			v.schema("área inválida", p("blocks", b, "area")...)
			continue
		}
		if blk.Start == nil {
			v.schema("start é obrigatório", p("blocks", b, "start")...)
		} else {
			v.intRange(*blk.Start, 0, modbus.MaxOffset, p("blocks", b, "start")...)
		}
		v.intRange(blk.Count, 1, area.MaxPerRead(), p("blocks", b, "count")...)
		v.intRange(blk.PollMS, MinPollMSTCP, MaxPollMS, p("blocks", b, "poll_ms")...)
	}

	if len(d.Tags) > MaxTags {
		v.schema(fmt.Sprintf("máximo de %d tags", MaxTags), p("tags")...)
	}
	for t := range d.Tags {
		tag := &d.Tags[t]
		tp := func(rest ...any) []any { return p(append([]any{"tags", t}, rest...)...) }
		v.uuid(tag.ID, tp("id")...)
		v.text(tag.Name, 120, tp("name")...)
		if a, err := modbus.ParseArea(tag.Address.Area); err != nil || tag.Address.Area != a.String() {
			v.schema("área inválida", tp("address", "area")...)
		}
		if tag.Address.Offset == nil {
			v.schema("offset é obrigatório", tp("address", "offset")...)
		} else {
			v.intRange(*tag.Address.Offset, 0, modbus.MaxOffset, tp("address", "offset")...)
		}
		if tag.Address.Bit != nil {
			v.intRange(*tag.Address.Bit, 0, 15, tp("address", "bit")...)
		}
		if typ, err := modbus.ParseDataType(tag.Type); err != nil || tag.Type != typ.String() {
			v.schema("tipo de dado inválido", tp("type")...)
		}
		if tag.WordOrder != "" {
			if o, err := modbus.ParseWordOrder(tag.WordOrder); err != nil || o.String() != tag.WordOrder {
				v.schema("word_order inválido (ABCD, CDAB, BADC ou DCBA)", tp("word_order")...)
			}
		}
		if tag.Scale != nil {
			for name, f := range map[string]*float64{"mul": tag.Scale.Mul, "add": tag.Scale.Add} {
				if f != nil && (math.IsNaN(*f) || math.IsInf(*f, 0)) {
					v.schema("escala inválida", tp("scale", name)...)
				}
			}
		}
		if tag.PollMS != 0 {
			v.intRange(tag.PollMS, MinPollMSTCP, MaxPollMS, tp("poll_ms")...)
		}
		if !validRoles[tag.Role] {
			v.schema(fmt.Sprintf("papel %q inválido", tag.Role), tp("role")...)
		}
		if tag.MachineID != "" {
			v.uuid(tag.MachineID, tp("machine_id")...)
		}
		if s := tag.Sampling; s != nil {
			if s.Deadband != nil && *s.Deadband < 0 {
				v.schema("deadband deve ser ≥ 0", tp("sampling", "deadband")...)
			}
			if s.MinIntervalS != nil {
				v.intRange(*s.MinIntervalS, 1, 86400, tp("sampling", "min_interval_s")...)
			}
			if s.MaxIntervalS != nil {
				v.intRange(*s.MaxIntervalS, 1, 86400, tp("sampling", "max_interval_s")...)
			}
		}
	}
}

// structurallyUsable indica se dá para aplicar as regras semânticas na tag sem
// gerar ruído (área, tipo e offset legíveis).
func (t *Tag) structurallyUsable() bool {
	a, errA := modbus.ParseArea(t.Address.Area)
	typ, errT := modbus.ParseDataType(t.Type)
	return errA == nil && errT == nil && a.Valid() && typ.Valid() && t.Address.Offset != nil
}

func (c *GatewayConfig) validateSemantics(v *validator) {
	// Por tag e por dispositivo.
	for d := range c.Devices {
		dev := &c.Devices[d]
		for t := range dev.Tags {
			tag := &dev.Tags[t]
			if !tag.structurallyUsable() {
				continue
			}
			tp := []any{"devices", d, "tags", t}
			checkTypedAddress(v, tag, tp)
			typ, _ := modbus.ParseDataType(tag.Type)
			if validRoles[tag.Role] && !roleAllows(tag.Role, typ) {
				v.add(RuleTagRoleType, fmt.Sprintf("O papel %s não aceita o tipo %s.", tag.Role, tag.Type), append(tp, "type")...)
			}
			if tag.Role != RoleCustom && tag.MachineID == "" {
				v.add(RuleTagMachineRequired, "Tags com papel diferente de \"custom\" exigem machine_id.", append(tp, "machine_id")...)
			}
			if tag.Sampling != nil {
				if tag.Role != RoleCustom && tag.Role != RoleSpeedActual {
					v.add(RuleTagSamplingRole, "\"sampling\" só vale para os papéis \"custom\" e \"speed.actual\".", append(tp, "sampling")...)
				}
				if s := tag.Sampling; s.MinIntervalS != nil && s.MaxIntervalS != nil && *s.MinIntervalS > *s.MaxIntervalS {
					v.add(RuleTagSamplingInterval, "sampling.min_interval_s não pode ser maior que sampling.max_interval_s.", append(tp, "sampling", "min_interval_s")...)
				}
			}
		}
		dev.validateBlocksAndPolls(v, d)
	}

	// Unicidade de ids e portas.
	unique := func(n int, key func(int) string, path func(int) []any, rule string) {
		seen := map[string]bool{}
		for i := 0; i < n; i++ {
			k := key(i)
			if seen[k] {
				v.add(rule, "Valor repetido.", path(i)...)
			}
			seen[k] = true
		}
	}
	unique(len(c.SerialBuses), func(i int) string { return c.SerialBuses[i].ID }, func(i int) []any { return []any{"serial_buses", i, "id"} }, RuleIDsUnique)
	unique(len(c.SerialBuses), func(i int) string { return c.SerialBuses[i].Port }, func(i int) []any { return []any{"serial_buses", i, "port"} }, RuleBusPortUnique)
	unique(len(c.Devices), func(i int) string { return c.Devices[i].ID }, func(i int) []any { return []any{"devices", i, "id"} }, RuleIDsUnique)
	unique(len(c.Machines), func(i int) string { return c.Machines[i].ID }, func(i int) []any { return []any{"machines", i, "id"} }, RuleIDsUnique)

	tagIDs := map[string]bool{}
	tagCount := 0
	for d, dev := range c.Devices {
		for t, tag := range dev.Tags {
			tagCount++
			if tagIDs[tag.ID] {
				v.add(RuleIDsUnique, "Id de tag repetido.", "devices", d, "tags", t, "id")
			}
			tagIDs[tag.ID] = true
		}
	}
	if tagCount > MaxTags {
		v.add(RuleLimitsTags, fmt.Sprintf("Máximo de %d tags por gateway.", MaxTags), "devices")
	}

	// Barramentos e endpoints.
	busIDs := map[string]bool{}
	for _, b := range c.SerialBuses {
		busIDs[b.ID] = true
	}
	unitsByBus := map[string]bool{}
	tcpEndpoints := map[string]bool{}
	for d, dev := range c.Devices {
		if dev.Params.UnitID == nil {
			continue
		}
		switch dev.Protocol {
		case ProtocolRTU:
			if !busIDs[dev.Params.Bus] {
				v.add(RuleBusRef, "params.bus precisa existir em serial_buses.", "devices", d, "params", "bus")
			}
			key := dev.Params.Bus + "#" + strconv.Itoa(*dev.Params.UnitID)
			if unitsByBus[key] {
				v.add(RuleBusUnitUnique, "unit_id repetido no mesmo barramento.", "devices", d, "params", "unit_id")
			}
			unitsByBus[key] = true
		case ProtocolTCP, ProtocolRTUOverTCP:
			key := fmt.Sprintf("%s:%d#%d", strings.ToLower(dev.Params.Host), dev.Params.Port, *dev.Params.UnitID)
			if tcpEndpoints[key] {
				v.add(RuleTCPEndpointUnique, "Dois dispositivos com o mesmo host, porta e unit_id.", "devices", d, "params")
			}
			tcpEndpoints[key] = true
		}
	}

	// Tags × máquinas.
	machineIDs := map[string]bool{}
	for _, m := range c.Machines {
		machineIDs[m.ID] = true
	}
	roles := map[string]map[string]bool{}
	maxPoll := map[string]int{}
	for d := range c.Devices {
		dev := &c.Devices[d]
		for t := range dev.Tags {
			tag := &dev.Tags[t]
			if tag.MachineID == "" {
				continue
			}
			if !machineIDs[tag.MachineID] {
				v.add(RuleTagMachineRef, "machine_id da tag precisa existir em machines.", "devices", d, "tags", t, "machine_id")
				continue
			}
			r := roles[tag.MachineID]
			if r == nil {
				r = map[string]bool{}
				roles[tag.MachineID] = r
			}
			if tag.Role != RoleCustom && r[tag.Role] {
				v.add(RuleTagRoleUnique, "No máximo uma tag por máquina e papel (exceto \"custom\").", "devices", d, "tags", t, "role")
			}
			r[tag.Role] = true
			if tag.structurallyUsable() && IsStateOrCounterRole(tag.Role) {
				if poll := dev.EffectivePollMS(tag); poll > 0 && poll > maxPoll[tag.MachineID] {
					maxPoll[tag.MachineID] = poll
				}
			}
		}
	}
	for m := range c.Machines {
		mc := &c.Machines[m]
		rules := mc.StateRules
		p := []any{"machines", m, "state_rules"}
		if req, ok := requiredFor[rules.Mode]; ok && !roles[mc.ID][req] {
			v.add(RuleMachineModeRoles, fmt.Sprintf("O modo %s exige tag com papel %s na máquina %s.", rules.Mode, req, mc.ID), append(p, "mode")...)
		}
		if rules.Mode == ModeStateCode && len(rules.Map) == 0 {
			v.add(RuleMachineStateMap, "O mapa de state_code precisa ter pelo menos um código.", append(p, "map")...)
		}
		if mp, ok := maxPoll[mc.ID]; ok && rules.CommLossAfter()*1000 < 3*mp {
			v.add(RuleMachineCommLoss, "comm_loss_after_s × 1000 deve ser ≥ 3 × o maior poll_ms das tags de estado/contador da máquina.", append(p, "comm_loss_after_s")...)
		}
		if rules.HeartbeatTimeoutS != nil && !roles[mc.ID][RoleHeartbeat] {
			v.add(RuleMachineHeartbeat, "heartbeat_timeout_s exige uma tag plc.heartbeat na máquina.", append(p, "heartbeat_timeout_s")...)
		}
	}
}

// checkTypedAddress aplica as regras de endereço tipado (área × tipo × bit × word_order × faixa).
func checkTypedAddress(v *validator, tag *Tag, tp []any) {
	at := func(rest ...any) []any { return append(append([]any{}, tp...), rest...) }
	area, _ := modbus.ParseArea(tag.Address.Area)
	typ, _ := modbus.ParseDataType(tag.Type)
	if area.IsBit() {
		if typ != modbus.Bool || tag.Address.Bit != nil || tag.WordOrder != "" {
			v.add(RuleAddressBitArea, "Coils e discrete inputs só aceitam type \"bool\", sem \"bit\" e sem \"word_order\".", at("type")...)
		}
		return
	}
	if typ == modbus.Bool && tag.Address.Bit == nil {
		v.add(RuleAddressRegisterBool, "Em registrador, type \"bool\" exige \"bit\" (0–15).", at("address", "bit")...)
	}
	if typ != modbus.Bool && tag.Address.Bit != nil {
		v.add(RuleAddressBitOnlyBool, "\"bit\" só vale para type \"bool\" em registrador.", at("address", "bit")...)
	}
	if typ.Is32Bit() != (tag.WordOrder != "") {
		v.add(RuleAddressWordOrder, "Tipos de 32 bits exigem \"word_order\"; bool e tipos de 16 bits não aceitam.", at("word_order")...)
	}
	if *tag.Address.Offset+typ.Registers()-1 > modbus.MaxOffset {
		v.add(RuleAddressRange, "O endereço final não pode passar de 65535.", at("address", "offset")...)
	}
}

func (d *Device) validateBlocksAndPolls(v *validator, i int) {
	type span struct {
		area   string
		lo, hi int
	}
	blocks := make([]span, 0, len(d.Blocks))
	for b, blk := range d.Blocks {
		if blk.Start == nil {
			blocks = append(blocks, span{area: "", lo: -1, hi: -2})
			continue
		}
		s := span{area: blk.Area, lo: *blk.Start, hi: *blk.Start + blk.Count - 1}
		if s.hi > modbus.MaxOffset {
			v.add(RuleBlockRange, "start + count − 1 não pode passar de 65535.", "devices", i, "blocks", b, "count")
		}
		blocks = append(blocks, s)
	}
	for a := range blocks {
		for b := a + 1; b < len(blocks); b++ {
			if blocks[a].area == "" || blocks[a].area != blocks[b].area {
				continue
			}
			if blocks[a].lo <= blocks[b].hi && blocks[b].lo <= blocks[a].hi {
				v.add(RuleBlockOverlap, "Blocos da mesma área no mesmo dispositivo não podem se sobrepor.", "devices", i, "blocks", b)
			}
		}
	}
	for t := range d.Tags {
		tag := &d.Tags[t]
		if !tag.structurallyUsable() {
			continue
		}
		sp := tag.Spec().Span()
		lo, hi := int(sp.Start), sp.End()
		inside, partial := false, false
		for _, b := range blocks {
			if b.area != tag.Address.Area {
				continue
			}
			if b.lo <= lo && hi <= b.hi {
				inside = true
			} else if lo <= b.hi && b.lo <= hi {
				partial = true
			}
		}
		tp := []any{"devices", i, "tags", t}
		switch {
		case !inside && partial:
			v.add(RuleTagBlockPartial, "A tag não pode ficar parcialmente dentro de um bloco.", append(tp, "address", "offset")...)
		case inside && tag.PollMS != 0:
			v.add(RuleTagPollSource, "Tag dentro de bloco não pode ter poll_ms (vale o do bloco).", append(tp, "poll_ms")...)
		case !inside && tag.PollMS == 0:
			v.add(RuleTagPollSource, "Tag fora de bloco exige poll_ms.", append(tp, "poll_ms")...)
		}
	}
	if d.Protocol == ProtocolRTU {
		for b, blk := range d.Blocks {
			if blk.PollMS < MinPollMSRTU {
				v.add(RulePollRTUMin, "Em RTU, poll_ms mínimo é 200.", "devices", i, "blocks", b, "poll_ms")
			}
		}
		for t, tag := range d.Tags {
			if tag.PollMS != 0 && tag.PollMS < MinPollMSRTU {
				v.add(RulePollRTUMin, "Em RTU, poll_ms mínimo é 200.", "devices", i, "tags", t, "poll_ms")
			}
		}
	}
}
