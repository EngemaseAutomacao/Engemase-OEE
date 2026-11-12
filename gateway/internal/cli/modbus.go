package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

func newModbusCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "modbus", Short: "Ferramentas Modbus de campo (somente leitura)"}
	cmd.AddCommand(newModbusReadCmd())
	return cmd
}

// decodeSpec é um --decode: tipo[:ORDEM]@índice[.bit], com índice relativo a --offset.
type decodeSpec struct {
	text  string
	typ   modbus.DataType
	order modbus.WordOrder
	index int
	bit   int
}

func parseDecodeSpec(s string) (decodeSpec, error) {
	d := decodeSpec{text: s, bit: -1}
	typePart, pos, ok := strings.Cut(s, "@")
	if !ok {
		return d, fmt.Errorf("--decode %q: use tipo[:ORDEM]@índice[.bit] (ex.: uint32:CDAB@4, bool@13.2)", s)
	}
	typeName, orderName, _ := strings.Cut(typePart, ":")
	var err error
	if d.typ, err = modbus.ParseDataType(typeName); err != nil {
		return d, fmt.Errorf("--decode %q: %w", s, err)
	}
	if d.order, err = modbus.ParseWordOrder(orderName); err != nil {
		return d, fmt.Errorf("--decode %q: %w", s, err)
	}
	if d.typ.Is32Bit() && d.order == modbus.WordOrderNone {
		return d, fmt.Errorf("--decode %q: tipos de 32 bits exigem a ordem (ABCD, CDAB, BADC ou DCBA)", s)
	}
	idx, bit, hasBit := strings.Cut(pos, ".")
	if d.index, err = strconv.Atoi(idx); err != nil || d.index < 0 {
		return d, fmt.Errorf("--decode %q: índice inválido", s)
	}
	if hasBit {
		if d.typ != modbus.Bool {
			return d, fmt.Errorf("--decode %q: .bit só vale para bool", s)
		}
		if d.bit, err = strconv.Atoi(bit); err != nil || d.bit < 0 || d.bit > 15 {
			return d, fmt.Errorf("--decode %q: bit deve estar entre 0 e 15", s)
		}
	}
	return d, nil
}

type readOutput struct {
	Target    string            `json:"target"`
	Unit      int               `json:"unit"`
	Area      string            `json:"area"`
	Offset    int               `json:"offset"`
	Count     int               `json:"count"`
	ReadMS    int64             `json:"read_ms"`
	Registers []uint16          `json:"registers,omitempty"`
	Bits      []bool            `json:"bits,omitempty"`
	Decoded   map[string]string `json:"decoded,omitempty"`
	OEEBlock  *modbus.OEEBlock  `json:"oee_block,omitempty"`
}

func newModbusReadCmd() *cobra.Command {
	var (
		target, areaName, orderName string
		unit, offset, count         int
		timeoutMS                   int
		decodes                     []string
		oeeBlock, asJSON            bool
	)
	cmd := &cobra.Command{
		Use:   "read --target tcp://IP:502 --unit 1 --area hr --offset 1000 --count 14",
		Short: "Lê registradores ou bits e imprime decodificado",
		Long: "Leitura ad hoc (endereço base 0: o 40001 da convenção é --area hr --offset 0).\n\n" +
			"Alvos: tcp://IP[:porta] · rtu+tcp://IP:porta (conversor transparente) · rtu:///dev/ttyUSB0?baud=19200&parity=E&stop_bits=1\n" +
			"Decodificação extra: --decode uint32:CDAB@4 (índice relativo a --offset), --decode bool@13.2 (bit 2).\n\n" +
			"ATENÇÃO: lê direto, sem passar pela fila do agente. Num barramento RS-485, pare o agente antes\n" +
			"(um mestre por barramento). Em Modbus TCP, ocupa uma conexão a mais no CLP.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			t, err := modbus.ParseTarget(target)
			if err != nil {
				return err
			}
			if timeoutMS > 0 {
				if timeoutMS < 50 || timeoutMS > 10000 {
					return fmt.Errorf("--timeout-ms fora da faixa 50–10000")
				}
				t.Timeout = time.Duration(timeoutMS) * time.Millisecond
			}
			area, err := modbus.ParseArea(areaName)
			if err != nil {
				return err
			}
			if unit < 0 || unit > 255 {
				return fmt.Errorf("--unit fora da faixa 0–255")
			}
			if offset < 0 || offset > modbus.MaxOffset {
				return fmt.Errorf("--offset fora da faixa 0–65535")
			}
			if oeeBlock && count < modbus.OEEBlockRegisters {
				count = modbus.OEEBlockRegisters
			}
			span := modbus.Span{Area: area, Start: uint16(offset), Count: uint16(min(max(count, 0), 65535))}
			if count < 1 || span.Validate() != nil {
				return fmt.Errorf("--count %d inválido: 1–%d em %s, sem passar do endereço 65535", count, area.MaxPerRead(), area)
			}
			order, err := modbus.ParseWordOrder(orderName)
			if err != nil {
				return err
			}
			if oeeBlock && area != modbus.HoldingRegister {
				return fmt.Errorf("--oee-block exige --area hr")
			}
			var specs []decodeSpec
			for _, s := range decodes {
				d, err := parseDecodeSpec(s)
				if err != nil {
					return err
				}
				if area.IsBit() || d.index+d.typ.Registers() > count {
					return fmt.Errorf("--decode %q fora da leitura (%d registradores)", s, count)
				}
				specs = append(specs, d)
			}

			r, err := modbus.Open(t)
			if err != nil {
				return err
			}
			defer r.Close()
			ctx, cancel := context.WithTimeout(cmd.Context(), 30*time.Second)
			defer cancel()
			start := time.Now()
			raw, err := r.ReadBlock(ctx, uint8(unit), span)
			if err != nil {
				return fmt.Errorf("leitura de %s em %s (unit %d): %w", span, t, unit, err)
			}
			out := readOutput{Target: t.String(), Unit: unit, Area: area.String(), Offset: offset, Count: count,
				ReadMS: time.Since(start).Milliseconds(), Registers: raw.Regs, Bits: raw.Bits}
			for _, d := range specs {
				if out.Decoded == nil {
					out.Decoded = map[string]string{}
				}
				v, err := modbus.DecodeRegisters(raw.Regs[d.index:d.index+d.typ.Registers()], d.typ, d.order, d.bit)
				if err != nil {
					out.Decoded[d.text] = "erro: " + err.Error()
					continue
				}
				out.Decoded[d.text] = v.String()
			}
			if oeeBlock {
				if order == modbus.WordOrderNone {
					order = modbus.CDAB
				}
				b, err := modbus.DecodeOEEBlock(raw.Regs, order)
				if err != nil {
					return err
				}
				out.OEEBlock = &b
			}
			if asJSON {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				return enc.Encode(out)
			}
			printRead(cmd.OutOrStdout(), out, area, specs, order)
			return nil
		},
	}
	f := cmd.Flags()
	f.StringVar(&target, "target", "", "alvo: tcp://IP[:porta], rtu+tcp://IP:porta ou rtu:///dev/tty...?baud=19200&parity=E")
	f.IntVar(&unit, "unit", 1, "unit id (TCP: 0–255; RTU: 1–247)")
	f.StringVar(&areaName, "area", "hr", "área: hr, ir, co, di (ou o nome completo)")
	f.IntVar(&offset, "offset", 0, "endereço inicial, base 0")
	f.IntVar(&count, "count", 1, "quantidade de registradores (≤125) ou bits (≤2000)")
	f.IntVar(&timeoutMS, "timeout-ms", 0, "timeout da leitura (padrão: 500 TCP / 300 RTU)")
	f.StringArrayVar(&decodes, "decode", nil, "decodificação extra: tipo[:ORDEM]@índice[.bit] (repetível)")
	f.BoolVar(&oeeBlock, "oee-block", false, "decodifica o bloco OEE padrão Engemase (14 HR a partir de --offset)")
	f.StringVar(&orderName, "word-order", "CDAB", "ordem das words de 32 bits do --oee-block")
	f.BoolVar(&asJSON, "json", false, "saída em JSON")
	_ = cmd.MarkFlagRequired("target")
	return cmd
}

func printRead(w io.Writer, out readOutput, area modbus.Area, specs []decodeSpec, order modbus.WordOrder) {
	fmt.Fprintf(w, "%s · unit %d · %s %d..%d · %d ms\n", out.Target, out.Unit, out.Area, out.Offset, out.Offset+out.Count-1, out.ReadMS)
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	if area.IsBit() {
		fmt.Fprintln(tw, "offset\tconvenção\tvalor")
		for i, b := range out.Bits {
			fmt.Fprintf(tw, "%d\t%s\t%v\n", out.Offset+i, area.Convention(uint16(out.Offset+i)), b)
		}
	} else {
		fmt.Fprintln(tw, "offset\tconvenção\thex\tuint16\tint16")
		for i, r := range out.Registers {
			fmt.Fprintf(tw, "%d\t%s\t0x%04X\t%d\t%d\n", out.Offset+i, area.Convention(uint16(out.Offset+i)), r, r, int16(r))
		}
	}
	_ = tw.Flush()
	for _, d := range specs {
		fmt.Fprintf(w, "%s = %s\n", d.text, out.Decoded[d.text])
	}
	if b := out.OEEBlock; b != nil {
		fmt.Fprintf(w, "\nBloco OEE padrão (32 bits em %s):\n", order)
		tw = tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		fmt.Fprintf(tw, "versao_bloco\t%d\n", b.Version)
		fmt.Fprintf(tw, "heartbeat\t%d\n", b.Heartbeat)
		fmt.Fprintf(tw, "estado\t%d (%s)\n", b.State, b.StateName())
		fmt.Fprintf(tw, "codigo_falha\t%d\n", b.FaultCode)
		fmt.Fprintf(tw, "contador_total\t%d\n", b.Total)
		fmt.Fprintf(tw, "contador_refugo\t%d\n", b.Reject)
		fmt.Fprintf(tw, "contador_bons\t%d\n", b.Good)
		fmt.Fprintf(tw, "produto\t%d\n", b.Product)
		fmt.Fprintf(tw, "velocidade\t%d\n", b.Speed)
		fmt.Fprintf(tw, "ciclo_ultimo_ms\t%d\n", b.LastCycleMS)
		fmt.Fprintf(tw, "bits_status\t0b%016b\n", b.StatusBits)
		_ = tw.Flush()
	}
}
