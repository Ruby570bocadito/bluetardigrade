// POST /api/auth/domain tests: the disarm contract (501), the JSON
// verdict mapping (credenciales / sin_rol / dominio / formato /
// peticion), the per-remote failure throttle and the success shape.
// The LDAP exchange itself is exercised in internal/ad against the
// real fixture; here the login seam is stubbed so each verdict branch
// is deterministic without a directory.

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
)

// stubDomainLogin swaps the login seam for one call and restores it;
// it records what the handler handed over (password included, to
// assert the buffer the API owns reaches the login unharmed).
func stubDomainLogin(t *testing.T, fn func(ctx context.Context, cfg *ad.DomainAuthConfig, user string, pw []byte) (*ad.DomainIdentity, error)) *[]string {
	t.Helper()
	var calls []string
	prev := domainLogin
	domainLogin = func(ctx context.Context, cfg *ad.DomainAuthConfig, user string, pw []byte) (*ad.DomainIdentity, error) {
		calls = append(calls, user+"|"+string(pw))
		return fn(ctx, cfg, user, pw)
	}
	t.Cleanup(func() { domainLogin = prev })
	return &calls
}

// POST through the hub's own server so the mux pattern matches
// exactly; the stubbed seam decides the verdict of each branch.
func postDomainLoginLive(t *testing.T, addr, body string) *http.Response {
	t.Helper()
	res, err := http.Post("http://"+addr+"/api/auth/domain", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/auth/domain: %v", err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func decodeVerdict(t *testing.T, res *http.Response) domainLoginResponse {
	t.Helper()
	var v domainLoginResponse
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatalf("decode verdict: %v", err)
	}
	return v
}

func TestDomainAuthDisarmed501(t *testing.T) {
	_, addr := newTestHub(t)
	res := postDomainLoginLive(t, addr, `{"user":"ana","password":"x"}`)
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", res.StatusCode)
	}
	v := decodeVerdict(t, res)
	if v.OK || v.Reason != "" {
		t.Errorf("verdict = %+v", v)
	}
}

func TestDomainAuthContract(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetDomainAuth(&ad.DomainAuthConfig{Server: "dc01", BaseDN: "DC=x", CAFile: "ca.pem"})

	t.Run("ok", func(t *testing.T) {
		stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, user string, _ []byte) (*ad.DomainIdentity, error) {
			return &ad.DomainIdentity{User: user, DisplayName: "Ana", Role: "analyst", Groups: []string{"SOC-Analistas"}, Domain: "CORP"}, nil
		})
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"secreta"}`)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", res.StatusCode)
		}
		if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q, want no-store", cc)
		}
		v := decodeVerdict(t, res)
		if !v.OK || v.Reason != "" || v.User != "ana" || v.Role != "analyst" || v.Domain != "CORP" {
			t.Errorf("verdict = %+v", v)
		}
		if len(v.Groups) != 1 || v.Groups[0] != "SOC-Analistas" {
			t.Errorf("groups = %v", v.Groups)
		}
	})

	t.Run("credenciales", func(t *testing.T) {
		stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
			return nil, ad.ErrLoginCredentials
		})
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"mala"}`)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.OK || v.Reason != "credenciales" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("sin_rol", func(t *testing.T) {
		stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
			return nil, ad.ErrLoginNoRole
		})
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"buena"}`)
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.OK || v.Reason != "sin_rol" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("dominio", func(t *testing.T) {
		stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
			return nil, fmt.Errorf("%w: dial", ad.ErrLoginDomainDown)
		})
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"buena"}`)
		if res.StatusCode != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.OK || v.Reason != "dominio" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("formato", func(t *testing.T) {
		stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
			return nil, ad.ErrLoginBadUserFormat
		})
		res := postDomainLoginLive(t, addr, `{"user":"a@b\\c","password":"x"}`)
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.OK || v.Reason != "formato" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("peticion_malformada", func(t *testing.T) {
		res := postDomainLoginLive(t, addr, `no es json`)
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.OK || v.Reason != "peticion" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("campos_demasiado_largos", func(t *testing.T) {
		long := strings.Repeat("a", 300)
		res := postDomainLoginLive(t, addr, fmt.Sprintf(`{"user":%q,"password":"x"}`, long))
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", res.StatusCode)
		}
		if v := decodeVerdict(t, res); v.Reason != "formato" {
			t.Errorf("verdict = %+v", v)
		}
	})

	t.Run("la_contrasena_llega_intacta_al_login", func(t *testing.T) {
		calls := stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
			return nil, ad.ErrLoginNoRole
		})
		_ = postDomainLoginLive(t, addr, `{"user":"ana","password":"se-cre-ta"}`)
		if len(*calls) != 1 || (*calls)[0] != "ana|se-cre-ta" {
			t.Errorf("calls = %v", *calls)
		}
	})
}

func TestDomainAuthThrottle(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetDomainAuth(&ad.DomainAuthConfig{Server: "dc01", BaseDN: "DC=x", CAFile: "ca.pem"})
	stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
		return nil, ad.ErrLoginCredentials
	})

	var sawThrottle bool
	for i := 0; i < domainFailBudget+5; i++ {
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"mala"}`)
		if res.StatusCode == http.StatusTooManyRequests {
			sawThrottle = true
			break
		}
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("intento %d: status = %d, want 401 (o 429 al agotar)", i, res.StatusCode)
		}
	}
	if !sawThrottle {
		t.Errorf("la dirección no llegó al 429 tras %d fallos", domainFailBudget+5)
	}
}

func TestDomainAuthErrorsDoNotThrottle(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetDomainAuth(&ad.DomainAuthConfig{Server: "dc01", BaseDN: "DC=x", CAFile: "ca.pem"})
	stubDomainLogin(t, func(_ context.Context, _ *ad.DomainAuthConfig, _ string, _ []byte) (*ad.DomainIdentity, error) {
		// Errores que NO son intentos de contraseña: un DC caído no
		// debe quemar el presupuesto de la IP del operador.
		return nil, fmt.Errorf("%w: dial", ad.ErrLoginDomainDown)
	})
	for i := 0; i < domainFailBudget+5; i++ {
		res := postDomainLoginLive(t, addr, `{"user":"ana","password":"x"}`)
		if res.StatusCode != http.StatusBadGateway {
			t.Fatalf("intento %d: status = %d, want 502 estable (el fallo del dominio no cuenta al presupuesto)", i, res.StatusCode)
		}
	}
}
