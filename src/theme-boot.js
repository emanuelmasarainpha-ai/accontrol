// Modo oscuro ANTES de dibujar la página (0.14.4): si en este dispositivo se eligió oscuro, se pone ya, para que
// al abrir de noche no haya un destello blanco. Es un archivo aparte porque la política de seguridad de
// index.html no permite código escrito dentro del HTML. El resto (el interruptor) está en src/ui/theme.js.
(function () {
  try {
    if (localStorage.getItem('accontrol.theme.v1') === 'dark') document.documentElement.dataset.theme = 'dark';
  } catch (error) {
    // Sin acceso al almacenamiento: se queda en claro.
  }
  // Intro del logo (0.18.5): una vez por sesión y nunca con «reducir movimiento». Se decide aquí, antes de dibujar,
  // para que la pantalla de la intro tape la app desde el primer instante. La reproduce src/ui/intro.js.
  try {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && sessionStorage.getItem('accontrol.intro.v1') !== 'seen') document.documentElement.classList.add('has-intro');
  } catch (error) {
    // Sin acceso al almacenamiento: sin intro.
  }
})();
