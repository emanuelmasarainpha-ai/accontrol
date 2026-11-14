// Modo oscuro ANTES de dibujar la página (0.14.4): si en este dispositivo se eligió oscuro, se pone ya, para que
// al abrir de noche no haya un destello blanco. Es un archivo aparte porque la política de seguridad de
// index.html no permite código escrito dentro del HTML. El resto (el interruptor) está en src/ui/theme.js.
(function () {
  try {
    if (localStorage.getItem('accontrol.theme.v1') === 'dark') document.documentElement.dataset.theme = 'dark';
  } catch (error) {
    // Sin acceso al almacenamiento: se queda en claro.
  }
})();
