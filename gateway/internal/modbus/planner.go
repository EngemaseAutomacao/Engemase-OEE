package modbus

import "sort"

// Plan agrupa faixas (tags fora de bloco) em leituras contíguas por área.
//
// Duas faixas da mesma área entram na mesma leitura se o buraco entre elas for de
// no máximo maxGap endereços e se a leitura resultante couber no limite da área
// (125 registradores ou 2000 bits). maxGap = 0 só junta faixas encostadas ou
// sobrepostas: é o padrão do agente, porque vários CLPs respondem exceção 02 ao
// ler endereços não mapeados.
func Plan(spans []Span, maxGap int) []Span {
	if len(spans) == 0 {
		return nil
	}
	if maxGap < 0 {
		maxGap = 0
	}
	sorted := append([]Span(nil), spans...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Area != sorted[j].Area {
			return sorted[i].Area < sorted[j].Area
		}
		if sorted[i].Start != sorted[j].Start {
			return sorted[i].Start < sorted[j].Start
		}
		return sorted[i].Count > sorted[j].Count
	})

	var out []Span
	cur := sorted[0]
	for _, s := range sorted[1:] {
		end := cur.End()
		newEnd := max(end, s.End())
		sameArea := s.Area == cur.Area
		closeEnough := int(s.Start) <= end+1+maxGap
		fits := newEnd-int(cur.Start)+1 <= cur.Area.MaxPerRead()
		if sameArea && closeEnough && fits {
			cur.Count = uint16(newEnd - int(cur.Start) + 1)
			continue
		}
		out = append(out, cur)
		cur = s
	}
	return append(out, cur)
}
