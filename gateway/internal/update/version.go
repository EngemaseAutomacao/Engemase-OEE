package update

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var semverRe = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)

// ValidVersion diz se v é semver (a versão do manifesto e do pacote).
func ValidVersion(v string) bool { return semverRe.MatchString(v) }

// CompareVersions compara duas versões semver (-1, 0, 1), com a precedência do
// semver 2.0: pré-release vem antes da final; metadado de build não conta.
func CompareVersions(a, b string) (int, error) {
	ma, mb := semverRe.FindStringSubmatch(a), semverRe.FindStringSubmatch(b)
	if ma == nil || mb == nil {
		return 0, fmt.Errorf("versão não é semver: %q × %q", a, b)
	}
	for i := 1; i <= 3; i++ {
		x, _ := strconv.ParseUint(ma[i], 10, 64)
		y, _ := strconv.ParseUint(mb[i], 10, 64)
		if x != y {
			if x < y {
				return -1, nil
			}
			return 1, nil
		}
	}
	pa, pb := ma[4], mb[4]
	switch {
	case pa == pb:
		return 0, nil
	case pa == "":
		return 1, nil
	case pb == "":
		return -1, nil
	}
	fa, fb := strings.Split(pa, "."), strings.Split(pb, ".")
	for i := 0; i < len(fa) && i < len(fb); i++ {
		if c := compareIdent(fa[i], fb[i]); c != 0 {
			return c, nil
		}
	}
	switch {
	case len(fa) < len(fb):
		return -1, nil
	case len(fa) > len(fb):
		return 1, nil
	}
	return 0, nil
}

func compareIdent(a, b string) int {
	na, ea := strconv.ParseUint(a, 10, 64)
	nb, eb := strconv.ParseUint(b, 10, 64)
	switch {
	case ea == nil && eb == nil:
		switch {
		case na < nb:
			return -1
		case na > nb:
			return 1
		}
		return 0
	case ea == nil:
		return -1 // numérico vem antes de texto
	case eb == nil:
		return 1
	}
	return strings.Compare(a, b)
}

// DebVersion é a versão do .deb para uma versão semver, como o nfpm gera
// (version_schema: semver): o pré-release "-rc.1" vira "~rc.1", que o dpkg ordena
// antes da final.
func DebVersion(v string) string {
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	if i := strings.IndexByte(v, '-'); i >= 0 {
		return v[:i] + "~" + v[i+1:]
	}
	return v
}
