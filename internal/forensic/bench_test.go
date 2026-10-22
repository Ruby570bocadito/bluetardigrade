package forensic

import (
	"fmt"
	"testing"
	"time"
)

// BenchmarkCaptureEnLaCota mide el camino caliente en régimen
// estacionario: el directorio ya está en la cota (defaultBundleFiles), así
// que cada Capture escribe un bundle y expira el más viejo. Es el
// régimen que el perfil del nightly señaló (evictOldFiles como una
// fracción dominante de la CPU del camino de alertas): bajo la cota la
// expiración solo hace un ReadDir, pero en la cota cada escritura paga
// el escaneo completo, el stat de cada fichero y la ordenación.
//
// La precarga queda fuera de la medida (b.ResetTimer): lo que se mide
// es el coste marginal por alerta una vez alcanzada la cota, que es el
// estado en el que vive un motor largo bajo ataque sostenido.
func BenchmarkCaptureEnLaCota(b *testing.B) {
	dir := b.TempDir()
	r := New(dir)
	for i := 0; i < defaultBundleFiles; i++ {
		a := mkAlert(fmt.Sprintf("%016x", i), "bench-01", "high", base.Format(time.RFC3339))
		if _, ok, err := r.Capture(a, base.Add(time.Duration(i)*time.Second)); err != nil || !ok {
			b.Fatalf("precarga %d: ok=%v err=%v", i, ok, err)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a := mkAlert(fmt.Sprintf("%016x", defaultBundleFiles+i), "bench-01", "high", base.Format(time.RFC3339))
		if _, ok, err := r.Capture(a, time.Now()); err != nil || !ok {
			b.Fatalf("capture %d: ok=%v err=%v", i, ok, err)
		}
	}
	if got := r.CountBundles(); got != defaultBundleFiles {
		b.Fatalf("bundles tras el bench = %d, want %d (la cota se cumple)", got, defaultBundleFiles)
	}
}

// BenchmarkCaptureBajoLaCota es el contraste: mismo trabajo de escritura
// pero directorio lejos de la cota, donde la expiración solo cuesta el
// ReadDir temprano. La distancia entre este número y el de EnLaCota
// cuantifica cuánto cuesta el mecanismo de expiración (y, tras el
// cambio, cuánto queda de él).
func BenchmarkCaptureBajoLaCota(b *testing.B) {
	dir := b.TempDir()
	r := New(dir)
	for i := 0; i < b.N+defaultBundleFiles/2; i++ {
		a := mkAlert(fmt.Sprintf("%016x", i), "bench-02", "high", base.Format(time.RFC3339))
		if _, ok, err := r.Capture(a, base.Add(time.Duration(i)*time.Second)); err != nil || !ok {
			b.Fatalf("capture %d: ok=%v err=%v", i, ok, err)
		}
		if i == defaultBundleFiles/2-1 {
			b.ResetTimer()
		}
	}
}
