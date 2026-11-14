---
name: ACCONTROL
description: Finanzas personales y de negocios en RD$, impresas como el valor de un billete dominicano.
colors:
  ink-900: "#141a2a"
  ink-800: "#1e2638"
  ink-500: "#4c5a78"
  ink-300: "#a6b0c8"
  ink-50: "#f1f3f7"
  paper: "#eef1ec"
  surface: "#ffffff"
  text: "#141b29"
  text-muted: "#525d70"
  border: "#dde2ea"
  border-soft: "#e6ebf2"
  chip-gray: "#edf0f5"
  personal: "#5b3a8c"
  personal-deep: "#34204f"
  personal-soft: "#eee8f6"
  personal-ink: "#4a2d78"
  freelancer: "#b85614"
  freelancer-deep: "#5c2a0c"
  freelancer-soft: "#fbebdd"
  freelancer-ink: "#8f410f"
  entrepreneur: "#1f7f86"
  entrepreneur-deep: "#0d3f43"
  entrepreneur-soft: "#dff0f0"
  entrepreneur-ink: "#17666c"
  company: "#b8283f"
  company-deep: "#5e1220"
  company-soft: "#f8e2e6"
  company-ink: "#96203a"
  income: "#168a55"
  income-deep: "#0e6a42"
  income-tint: "#eef9f3"
  alert: "#c73a3a"
  alert-deep: "#a32727"
  alert-tint: "#fef3f3"
  caution: "#b87800"
  caution-deep: "#8a5a00"
  caution-tint: "#fff8e6"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 12.5vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 6vw, 2.125rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "0.16em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  hero: "24px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.personal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.personal-ink}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
  chip:
    backgroundColor: "{colors.chip-gray}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  banknote:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.personal-ink}"
    rounded: "{rounded.hero}"
    padding: "24px 16px 36px"
  nav-bar:
    backgroundColor: "{colors.personal-deep}"
    textColor: "{colors.surface}"
---

# Design System: ACCONTROL

## Overview

**Creative North Star: "El billete dominicano"**

Cada espacio de trabajo es una denominación. Igual que un billete se reconoce por su color antes de leer la cifra, la persona sabe en qué espacio está (Personal, Freelancer, Emprendedor o Empresa) por el color de la barra, y lee su «Disponible» impreso como el valor de un billete: numerales condensados grandes, doble filete fino, una roseta de guilloché trazada con curvas matemáticas y una línea de microtexto como borde de seguridad. El número se ve emitido con cuidado; por eso se cree.

Es una herramienta de uso diario (modo Operate): densidad media, lectura rápida en un Android modesto y en computadora. La expresión vive en pocos lugares precisos (la barra, el billete de Inicio, los títulos condensados, los estados vacíos con roseta) y el resto es papel claro y hojas blancas tranquilas. Rechaza la tarjeta azul de fintech sobre fondo gris, el panel pastel con aspecto de juego y el banco genérico.

Los colores de denominación están ajustados: cada uno tiene una versión de relleno con texto blanco que pasa AA, una profunda para barras, una suave para fondos y una «tinta» para texto sobre papel.

**Key Characteristics:**
- Color por denominación, inyectado con `body[data-kind]` en cuatro variables (`--kind`, `--kind-deep`, `--kind-soft`, `--kind-ink`).
- Papel de seguridad gris verdoso frío (no crema) con hojas blancas encima.
- Barlow para el texto, Barlow Semi Condensed para cifras de valor y títulos; numerales tabulares.
- Guilloché real (hipotrocoides SVG generados en `src/ui/guilloche.js`), siempre tenue y enmascarado lejos del texto.
- Movimiento corto (120–280 ms), solo `transform` y `opacity`, sin rebote; instantáneo con «reducir movimiento».

## Colors

Papel frío, tinta de grabado azul-grafito y un solo color de denominación activo a la vez; verde, rojo y ámbar tienen significado financiero fijo.

### Primary
- **Violeta Personal** (personal / -deep / -soft / -ink): denominación por defecto. Rellena botones principales y lo seleccionado; la versión profunda pinta la barra superior (celular) y la lateral (computadora); la tinta colorea el valor del billete y la pestaña activa.
- **Naranja tostado Freelancer**, **Verde azulado Emprendedor**, **Carmín Empresa**: mismas cuatro funciones cuando ese espacio está abierto. Nunca aparecen dos denominaciones en la misma pantalla salvo en el selector de espacio.

### Secondary
- **Verde financiero** (income, income-deep, income-tint): ingresos, dinero libre, metas cumplidas.

### Tertiary
- **Rojo de alerta** (alert, alert-deep, alert-tint): solo errores, avisos de seguridad y valores negativos.
- **Ámbar de precaución** (caution…): riesgo medio y cuotas próximas, siempre con texto e ícono.

### Neutral
- **Tinta de grabado** (ink-900 … ink-50): textos fuertes, títulos, gastos en gráficos (ink-500), ahorro (ink-300). En el código se llama `--navy-*` por historia.
- **Papel de seguridad** (paper): fondo de toda la app.
- **Hoja** (surface): paneles, billete, campos.
- **Texto** y **Texto apagado**: cuerpo y explicaciones.
- **Filete** (border, border-soft): bordes de campos y de paneles.

### Modo oscuro: «el billete de noche»
El mismo mundo de noche (`:root[data-theme='dark']` en `tokens.css`): papel nocturno (#0e121a), hoja (#161c28), tinta clara (#eceff4). Las escalas se invierten (fondos -50/-100 oscuros teñidos; textos -600/-900 claros) y cada denominación tiene su tinta de noche (violeta #cdbbf0, naranja #f3ab72, verde azulado #79d3d9, carmín #f5979f) sobre su fondo suave oscuro. Los rellenos con texto blanco usan `--solid-*` y no se invierten. Contraste AA de cada pareja comprobado en `test/theme.test.js`.

### Named Rules
**La Regla de Una Denominación.** El color del espacio activo es el único acento de marca en pantalla. Cambiar de espacio cambia el color; nunca se mezclan.

**La Regla del Rojo Reservado.** El rojo significa alerta o negativo, nada más. Los gastos son tinta, no rojo, para que el rojo conserve su peso.

**La Regla del Color con Palabras.** Ningún estado se comunica solo con color: siempre hay texto o ícono al lado.

## Typography

**Display Font:** Barlow Semi Condensed (con Barlow y la del sistema)
**Body Font:** Barlow (con system-ui)

**Character:** Una grotesca de origen señalético con su variante condensada: legible y sobria en el texto, con la autoridad compacta de los numerales impresos en un billete. Guardadas en la app (`src/styles/fonts/`, licencia OFL), pesos 400/600 y 600/700.

### Hierarchy
- **Display** (700, clamp(2.75rem, 12.5vw, 4.5rem), 1): el valor del billete. Símbolo RD$ y centavos al 46–50 % del tamaño. Con cifras largas baja a clamp(2rem, 9vw, 3.5rem).
- **Headline** (700, clamp(1.75rem, 6vw, 2.125rem), 1.1): título de cada pantalla, en tinta, con `text-wrap: balance`.
- **Title** (700, 1.1875rem): títulos de panel.
- **Body** (400, 1rem, 1.5): texto general; los campos usan 16 px para evitar el zoom del teléfono.
- **Label** (700, 0.8125rem, 0.16em, MAYÚSCULAS): el nombre del valor del billete («DISPONIBLE»). Es una etiqueta de dato, no un titular decorativo.

### Named Rules
**La Regla del Numeral de Valor.** Toda cifra de dinero protagonista usa Barlow Semi Condensed con numerales tabulares; el texto corrido nunca.

## Layout

Celular primero. Un margen lateral de 16 px (24 px desde 640 px). En celular: barra superior del color profundo del espacio, contenido en una columna y barra de pestañas blanca translúcida abajo con botón flotante (+); los paneles con cifras dejan 64 px libres a la derecha hasta 899 px para que el botón no tape nada. Desde 900 px: barra lateral de 248 px en el color profundo del espacio y contenido en rejilla de 2 columnas donde haga falta. Puntos de cambio usados: 640, 720, 900, 960 y 1100 px. Ritmo de espacios en pasos de 4/8 (4, 8, 12, 16, 24, 32, 48). Todo lo tocable mide al menos 44 px.

## Elevation & Depth

Híbrido sobrio: el papel es plano y las hojas blancas se separan con un filete casi invisible y una sombra suave en dos capas. La sombra fuerte se reserva para lo que flota (diálogos, hojas, el billete).

### Shadow Vocabulary
- **Suave** (`0 1px 2px rgb(15 39 71 / 4%), 0 6px 20px rgb(15 39 71 / 6%)`): paneles y tarjetas.
- **Elevada** (`0 2px 6px rgb(15 39 71 / 8%), 0 14px 32px rgb(15 39 71 / 14%)`): el billete y elementos destacados.
- **Flotante** (`0 12px 40px rgb(15 39 71 / 22%)`): diálogos y menús.
- **Botón principal**: brillo interior de 1 px arriba más una sombra teñida del color profundo del espacio.

### Named Rules
**La Regla del Papel Plano.** El fondo nunca lleva sombra ni degradado; la profundidad la dan las hojas encima.

## Shapes

Esquinas generosas pero no infladas: 12 px en botones y campos, 20 px en paneles, 24 px en el billete, píldora en las etiquetas. El billete lleva **doble filete**: un borde exterior al 50 % del color del espacio y, 5 px adentro, un segundo filete al 26 %. La roseta de guilloché es circular, se recorta por el borde derecho del billete y se desvanece con una máscara hacia el texto. La marca es una «A» dentro de un doble filete redondeado (`icons/mark.svg`).

## Components

### Buttons
- **Shape:** esquinas suaves (12 px), alto mínimo 44 px, peso 600.
- **Primary:** relleno del color del espacio, texto blanco, brillo interior y sombra teñida.
- **Ghost:** hoja blanca con filete gris y texto en tinta del espacio.
- **Danger / Danger ghost:** rojo de alerta lleno, o blanco con texto rojo profundo.
- **Press:** se hunde con `scale` en 120 ms; el color cambia al instante. Foco visible con contorno de 2 px en tinta.

### Chips
- **Style:** píldora gris claro con texto apagado, 0.75rem, peso 600. El sello DEMO usa el mismo molde.

### Cards / Containers
- **Corner Style:** 20 px.
- **Background:** hoja blanca sobre papel.
- **Shadow Strategy:** sombra Suave (ver Elevation).
- **Border:** filete casi invisible (border-soft); en error, fondo y borde rojo tenue.
- **Internal Padding:** 16 px; 24 px desde 640 px.

### Inputs / Fields
- **Style:** hoja blanca, filete gris medio, 12 px, 16 px de letra.
- **Focus:** contorno de 2 px en tinta (ink-500).
- **Error:** borde rojo y fondo rojo tenue, con mensaje en texto.

### Navigation
- **Celular:** barra superior en color profundo del espacio con ACCONTROL y selector de espacio; pestañas abajo en hoja blanca translúcida; la activa en tinta del espacio con peso 600 y una píldora suave (`--kind-soft`, 56×28 px) detrás del ícono que aparece con `--ease-pop`.
- **Computadora:** barra lateral en color profundo del espacio, texto blanco; el enlace activo lleva un fondo blanco al 14 % y una barrita blanca de 3 px a la izquierda que crece desde el centro.
- **Botón + (celular):** círculo de 56 px que va del color del espacio a su versión profunda, con sombra teñida; se hunde al tocarlo.

### Interruptor del sol y la luna
Botón de 44 px con el sol y la luna en **PNG sin fondo** (`src/assets/sun.png`, `moon.png`): sol dorado con halo y rayos alternados; luna creciente lavanda con cráteres y dos estrellas. Al anochecer el sol gira 140°, se encoge y se hunde mientras la luna entra girando (transform, 280 ms) y cuatro chispas saltan desde el centro (doradas de día, plateadas de noche). En el menú lateral, en Ajustes (grande) y en las pantallas de acceso.

### Ojo de la contraseña
Botón de 44 px: ojo **cerrado** (párpado con pestañas) cuando la contraseña está oculta, **abierto** cuando se ve. Al cambiar, una estela del ojo con desenfoque fijo aparece y se va (efecto de desenfoque de movimiento; solo transform y opacity).

### Chele, el guía
Mascota del recorrido: robotcito de traje negro con lentes dorados y regla. Viste la **denominación del espacio**: audífonos, antena, corbata, pin y brillo de los ojos usan `--kind` / `--kind-deep` (mezclados con blanco para los tonos claros). Va al lado de su globo, nunca encima de lo resaltado; se mueve solo con transform y opacity.

### El billete (signature)
La tarjeta de «Disponible» en Inicio: hoja blanca con doble filete del color del espacio, roseta de guilloché a la derecha (opacidad 0.34, enmascarada), etiqueta DISPONIBLE, valor Display en tinta del espacio, línea explicativa, botones Registrar ingreso / Registrar gasto y una fila de microtexto de 7 px abajo. Al llegar, la roseta entra girando un poco y el valor cuenta hasta su cifra exacta (el lector de pantalla recibe la cifra final de una vez).

## Do's and Don'ts

### Do:
- **Do** colorear con `--kind`, `--kind-deep`, `--kind-soft` y `--kind-ink`, nunca con el hex de una denominación concreta.
- **Do** animar solo `transform` y `opacity`, con `--dur-press` (120 ms), `--dur-base` (200 ms) o `--dur-enter` (280 ms) y las curvas `--ease-out`, `--ease-in-out` o `--ease-pop`.
- **Do** mantener la roseta y el microtexto tenues y lejos del texto que se lee.
- **Do** marcar todo dato de demostración con el sello DEMO.
- **Do** poner los estilos en los archivos CSS (la CSP prohíbe estilos en línea) y lo dinámico por CSSOM.

### Don't:
- **Don't** usar rojo para gastos ni para decorar.
- **Don't** usar curvas con rebote ni animaciones de más de 300 ms.
- **Don't** poner degradados ni sombras en el papel de fondo.
- **Don't** añadir bordes laterales gruesos de color como acento de tarjetas.
- **Don't** cargar letras ni librerías de servicios externos.
- **Don't** escribir `#fff` como fondo de hojas o controles (usa `--surface`) ni usar una escala -600/-900 como fondo con texto blanco (usa `--solid-*`): de noche se invertiría.
