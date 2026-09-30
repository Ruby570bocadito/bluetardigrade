#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
arq_v04/generator.py — versioned generator of the body of
docs/arquitectura-tecnica-v0.7.pdf (cover is rendered separately from
docs/assets/src/cover-v0.7.html and merged by merge_and_meta.py).
The directory name arq_v04 records where the pipeline was born (v0.4); it
builds the current revision of the series.

Pipeline (all versioned in the repo, no external tooling required beyond
python3 + reportlab + pypdf for the body/merge, and node + playwright for
the two render steps):

    bash scripts/arq_v04/build.sh

Design notes:
- House visual identity (accent #298bbc, structural #344a55, text #1e2021,
  muted #7e8588) is the series identity certified in v0.1..v0.3 and shared
  with docs/assets/src/diagram_arquitectura.html. It is kept verbatim for
  series continuity; all derived tints stay in the same hue family.
- TOC is auto-generated (TocDocTemplate + multiBuild), never hand-numbered.
- Chapter numbering: cover and TOC carry no chapter number; body starts at 1.
- Page numbering: TOC page shows roman "i"; body resets to arabic 1.
"""

import hashlib
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_BODY = os.path.join(REPO, "docs", "arquitectura-tecnica-v0.7.body.pdf")

# ---------------------------------------------------------------- fonts ----
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans", f"{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf"))
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
registerFontFamily("DejaVuSans", normal="DejaVuSans", bold="DejaVuSans")

# Skill-provided glyph fallback (mixed-script safety net for Paragraph()).
import sys  # noqa: E402
sys.path.insert(0, "/home/z/my-project/skills/pdf/scripts")
try:
    from pdf import install_font_fallback  # noqa: E402
    install_font_fallback()
except Exception:
    # The fallback is best-effort for exotic glyphs; the document is pure
    # Latin-1 Spanish plus ASCII, fully covered by FreeSerif/DejaVuSans.
    pass

# ------------------------------------------------- house palette (series) ---
# Same hue family as docs/assets/src/*.html (#298bbc accent, #344a55 mid).
ACCENT = colors.HexColor("#298bbc")       # XS tier: rules, captions, small fills
HEADER_FILL = colors.HexColor("#344a55")  # M tier: table headers, H1
TEXT_PRIMARY = colors.HexColor("#1e2021")
TEXT_MUTED = colors.HexColor("#7e8588")
BORDER = colors.HexColor("#d7dee2")       # S tier: grid lines
CARD_BG = colors.HexColor("#f4f6f7")      # L tier: callout background
TABLE_STRIPE = colors.HexColor("#eef3f6")  # L tier: odd rows

# ---------------------------------------------------------------- layout ---
MARGIN = 0.95 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
H1_ORPHAN = AVAIL_H * 0.25

DOC_TITLE = "Arquitectura Técnica - Framework de Detección de Amenazas en Tiempo Real"
FOOTER_LEFT = "Ruby570bocadito · security-framework v0.7"

# ---------------------------------------------------------------- styles ---
body = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=16.5,
                      alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY,
                      spaceBefore=0, spaceAfter=9)
h1 = ParagraphStyle("H1", fontName="FreeSerif", fontSize=20, leading=26,
                    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10)
h2 = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14, leading=19,
                    textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=7)
caption = ParagraphStyle("Caption", fontName="FreeSerif", fontSize=8.5, leading=12,
                         alignment=TA_CENTER, textColor=TEXT_MUTED,
                         spaceBefore=3, spaceAfter=6)
code_style = ParagraphStyle("Code", fontName="DejaVuSans", fontSize=8, leading=11.5,
                            textColor=TEXT_PRIMARY, alignment=TA_LEFT)
cell = ParagraphStyle("Cell", fontName="FreeSerif", fontSize=9, leading=12.5,
                      textColor=TEXT_PRIMARY, alignment=TA_LEFT)
cell_head = ParagraphStyle("CellHead", fontName="FreeSerif", fontSize=9, leading=12.5,
                           textColor=colors.white, alignment=TA_LEFT)
stat_big = ParagraphStyle("StatBig", fontName="FreeSerif", fontSize=21, leading=25,
                          textColor=ACCENT, alignment=TA_CENTER)
stat_lbl = ParagraphStyle("StatLbl", fontName="FreeSerif", fontSize=8.5, leading=11.5,
                          textColor=TEXT_MUTED, alignment=TA_CENTER)
toc_title_style = ParagraphStyle("TocTitle", fontName="FreeSerif", fontSize=20,
                                 leading=26, textColor=HEADER_FILL, spaceAfter=14)

TOC_L0 = ParagraphStyle("TOC0", fontName="FreeSerif", fontSize=11, leading=17, leftIndent=6)
TOC_L1 = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=9.5, leading=14.5,
                        leftIndent=26, textColor=TEXT_PRIMARY)


# ------------------------------------------------------------- doc class ---
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            # Displayed folio: the TOC page is internal page 1 (roman i) and
            # the body restarts the arabic counter at 1 on internal page 2.
            self.notify("TOCEntry", (level, text, max(1, self.page - 1), key))


def on_page(canvas, doc):
    """Header + footer. TOC page (doc.page == 1) shows roman i; body arabic."""
    canvas.saveState()
    # header
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE)
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    # footer
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, 0.45 * inch, FOOTER_LEFT)
    page_label = "i" if doc.page == 1 else str(doc.page - 1)
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, page_label)
    canvas.restoreState()


# --------------------------------------------------------------- helpers ---
def esc(t):
    return t.replace("&", "&").replace("<", "<").replace(">", ">")


def heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{esc(text)}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def safe_keep(elements, max_ratio=0.4):
    total = 0
    for el in elements:
        _, hgt = el.wrap(AVAIL_W, PAGE_H)
        total += hgt
    if total <= PAGE_H * max_ratio:
        return [KeepTogether(elements)]
    if len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)


def h1_block(num, title, first_para_text):
    """H1 heading + accent rule + first paragraph, orphan-protected."""
    head = heading(f"{num}. {title}", h1, level=0)
    rule = Table([[""]], colWidths=[AVAIL_W], rowHeights=[2])
    rule.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 1.1, ACCENT),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    first = para(first_para_text)
    return [CondPageBreak(H1_ORPHAN)] + safe_keep([head, rule, Spacer(1, 6), first])


def h2_block(text, first_flowable=None):
    head = heading(text, h2, level=1)
    if first_flowable is None:
        return [head]
    return safe_keep([head, first_flowable])


def para(text):
    # Typographic rule: an em dash must never start a line — bind it to the
    # previous word with a non-breaking space (the space after stays breakable).
    return Paragraph(text.replace(" \u2014 ", "\u00a0\u2014 "), body)


def make_table(headers, rows, ratios, cap=None, header_align=None):
    """House table: Paragraph cells, proportional widths, striped rows."""
    assert abs(sum(ratios) - 1.0) < 1e-6, "ratios must sum to 1"
    widths = [r * AVAIL_W for r in ratios]
    assert sum(widths) <= AVAIL_W + 0.5
    data = [[Paragraph(f"<b>{esc(h)}</b>", cell_head) for h in headers]]
    for row in rows:
        data.append([Paragraph(c, cell) for c in row])
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      colors.white if i % 2 == 1 else TABLE_STRIPE))
    t.setStyle(TableStyle(style))
    out = [Spacer(1, 12), t]
    if cap:
        out += [Spacer(1, 2), Paragraph(cap, caption), Spacer(1, 8)]
    else:
        out += [Spacer(1, 10)]
    return out


def code_block(lines, cap=None):
    """Code panel: DejaVu mono, light bg, accent left border."""
    txt = "<br/>".join(esc(ln) if ln else " " for ln in lines)
    inner = Paragraph(txt, code_style)
    t = Table([[inner]], colWidths=[AVAIL_W * 0.96], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    out = [Spacer(1, 8), t]
    if cap:
        out += [Spacer(1, 2), Paragraph(cap, caption), Spacer(1, 8)]
    else:
        out += [Spacer(1, 8)]
    return out


def callout_stats(items, cap=None):
    """Row of big-number stat callouts (data-to-ink rule)."""
    cells = []
    for big, lbl in items:
        cells.append(Table(
            [[Paragraph(f"<b>{esc(big)}</b>", stat_big)],
             [Paragraph(lbl, stat_lbl)]],
            colWidths=[AVAIL_W / len(items) - 14],
        ))
    for c in cells:
        c.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
    row = Table([cells], colWidths=[AVAIL_W / len(items)] * len(items), hAlign="CENTER")
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    out = [Spacer(1, 10), row]
    if cap:
        out += [Spacer(1, 2), Paragraph(cap, caption)]
    out += [Spacer(1, 10)]
    return out


def fit_image(path, max_w, max_h):
    from PIL import Image as PILImage
    with PILImage.open(path) as im:
        ow, oh = im.size
    ratio = min(max_w / ow if ow > max_w else 1.0, max_h / oh if oh > max_h else 1.0)
    return Image(path, width=ow * ratio, height=oh * ratio)


def figure(path, cap, max_h=300):
    img = fit_image(os.path.join(REPO, path), AVAIL_W * 0.96, max_h)
    img.hAlign = "CENTER"
    return [Spacer(1, 10)] + safe_keep([img, Paragraph(cap, caption)]) + [Spacer(1, 10)]


# ============================================================== content ====
story = []

# ---- TOC page (front matter, roman i) ----
story.append(Paragraph("<b>Índice</b>", toc_title_style))
toc = TableOfContents()
toc.levelStyles = [TOC_L0, TOC_L1]
story.append(toc)
story.append(PageBreak())

# ---- 1. Visión y Filosofía de Diseño ----
story += h1_block(1, "Visión y Filosofía de Diseño",
    "Este documento define la arquitectura técnica de un framework open source de detección de amenazas en "
    "tiempo real, concebido como alternativa moderna a Fibratus. El proyecto combina un sensor de eventos del "
    "sistema anclado en ETW con un motor de detección de comportamiento, correlación de secuencias y una consola "
    "web interactiva de triaje. El nombre del proyecto es provisional (security-framework) y se mantendrá hasta "
    "que la comunidad elija la marca definitiva. A diferencia de la v0.1, que describía una promesa de diseño, "
    "esta revisión v0.7 describe el sistema tal como está implementado y verificado hoy: cada afirmación de este "
    "texto corresponde a código en el repositorio, con pruebas de unidad, E2E sobre binarios reales y mediciones "
    "de rendimiento publicadas. Es la cuarta revisión producida por el pipeline de generación versionado en el "
    "propio árbol (scripts/arq_v04/, estrenado por la v0.4), de modo que ninguna revisión de la serie dependa "
    "de herramientas desaparecidas para reproducirse.")

story += h2_block("1.1 Defensa informada por ofensiva", para(
    "La ventaja competitiva central del proyecto no es tecnológica sino cognitiva: quien diseña las detecciones "
    "ha operado del otro lado del tablero. Un red teamer sabe qué ruido produce Cobalt Strike al inyectar, cómo "
    "se comporta Mimikatz al abrir LSASS, y qué cadena de procesos deja tras de sí un phishing con PowerShell "
    "ofuscado. Ese conocimiento convierte las reglas de detección en algo cercano al comportamiento real de un "
    "adversario, no a patrones teóricos de laboratorio. Cada módulo del framework se plantea desde la pregunta: "
    "¿cómo intentaré evadir esto en mi próxima operación, y cómo lo cierro?"))
story.append(para(
    "De esta filosofía se derivan tres principios de diseño que gobiernan todas las decisiones de esta "
    "arquitectura. Primero, el comportamiento importa más que las firmas: las Indicators of Compromise caducan, "
    "las TTPs persisten. Segundo, la telemetría debe ser resistente a la evasión: el sensor se ancla en ETW "
    "user-mode y no en hooks de user-mode que un malware pueda desinstalar. Tercero, la usabilidad es una "
    "feature de seguridad: una herramienta que nadie mira por complicada no detecta nada."))

story += h2_block("1.2 Qué mejoramos respecto a Fibratus", para(
    "Fibratus es un excelente punto de referencia: su motor de reglas, su soporte ETW y su integración YARA "
    "demuestran madurez técnica. El análisis previo del proyecto identificó seis áreas donde este framework "
    "puede diferenciarse de forma clara. La tabla siguiente resume el posicionamiento objetivo, que el roadmap "
    "del capítulo 7 convierte en entregables concretos y que la columna de estado de ese mismo capítulo "
    "contrasta con la realidad."))

story += make_table(
    ["Área", "Fibratus (estado actual)", "Enfoque de este framework"],
    [
        ["Rendimiento",
         "Bueno en cargas normales, con degradación bajo presión extrema de eventos.",
         "Pipeline con buffers acotados, capas de estado con límites duros y evaluación O(1) por regla "
         "indexada; latencia p99 medida en CI con bench nocturno."],
        ["Integración SIEM/SOAR",
         "Exportación por formatos, sin conectores plug-and-play.",
         "Webhook de alertas con cola acotada y token Bearer, notificaciones externas (Slack, Telegram, "
         "email), sumideros SIEM nativos (Elasticsearch Bulk API y Splunk HEC) y export JSONL/CSV con "
         "neutralización de inyección de fórmulas."],
        ["Experiencia de usuario",
         "Interfaz principalmente CLI.",
         "Consola web Next.js con triaje en vivo, gestión visual de supresiones, dashboard de operaciones "
         "con telemetría real y respuesta activa auditada desde la propia API."],
        ["Threat hunting",
         "Detección reactiva basada en reglas conocidas.",
         "Reglas sembradas desde TTPs ofensivas validadas en laboratorio, correlación multi-etapa y "
         "detección volumétrica y de beaconing."],
        ["Contenedores y K8s",
         "Soporte limitado en el núcleo.",
         "Collector eBPF consciente de namespaces y cgroups planificado en fase 2 (aún no implementado)."],
        ["Interoperabilidad de reglas",
         "Formato propio cerrado.",
         "Importador Sigma determinista con procedencia preservada y validación fail-loud por regla."],
    ],
    [0.16, 0.32, 0.52],
    "Tabla 1. Comparativa de posicionamiento frente a Fibratus por área funcional.")

story += callout_stats(
    [("0,4 ms", "p99 medido de ingest→alerta en loopback (bench, 2 000 eventos)"),
     ("17 + 4", "operadores de reglas (11 + familia i*) + detectores conductuales y volumétricos"),
     ("0", "dependencias de driver de kernel (ETW user-mode, sin Sysmon obligatorio)")])

story += h2_block("1.3 Del diseño a la implementación", para(
    "La v0.1 de este documento se escribió antes del primer commit y definía el norte. Desde entonces, el "
    "desarrollo por rondas ha aterrizado y verificado el núcleo completo: el pipeline de ingesta con "
    "autenticación por token compartido y rotación, el motor de reglas con recarga en caliente, el correlador "
    "de kill-chains, el detector de beaconing, el detector de umbrales volumétricos, el scoring de riesgo por "
    "host, el importador Sigma, la persistencia SQLite opcional, el webhook de alertas, la exportación "
    "JSONL/CSV y la consola web de operaciones. Las notificaciones externas (C2), los sumideros SIEM "
    "nativos y la respuesta activa (C3) — documentados de primera mano por la v0.4 tras su ciclo completo "
    "de diseño, dictamen, aterrizaje y re-revisión — se amplían en esta revisión con la operabilidad "
    "forense de la vista de consola de C3 — filtro por clase de intento, ventana de cola controlable por "
    "el operador y exportación JSONL de la cola visible —, aterrizada por la ola de consola 4967cad. "
    "El roadmap interno registra 13 de 17 líneas cerradas según las actas del Director (17h45) y del rol de "
    "seguridad (17h58) — la catorceava, la consola de respuesta activa, figura como propuesta del acta "
    "18h20 a la espera de certificación del Director —, y los cuatro paquetes de detección (A1 a A4) tienen "
    "el ciclo de vida completo."))
story.append(para(
    "Esta revisión mantiene la estructura de capítulos de la v0.1 para que la lectura comparativa sea directa, "
    "pero corrige tres tipos de desviación que docs/README.md documentaba con honestidad: el stack de la consola "
    "(Next.js 16 en lugar de React + Vite), la API del motor (net/http de stdlib en lugar de Gin, con OpenAPI "
    "mantenido a mano y validado contra el motor vivo) y el conjunto real de operadores y tipos de evento. Todo "
    "lo que la v0.1 anunciaba como fase futura y sigue sin implementar (YARA, gRPC, filaments Python, eBPF) se "
    "declara explícitamente como pendiente en el capítulo 7, sin presentarlo como capacidad existente."))

# ---- 2. Arquitectura General del Sistema ----
story += h1_block(2, "Arquitectura General del Sistema",
    "La arquitectura sigue un modelo de tres planos desacoplados: recolección (sensor), análisis (motor) y "
    "consumo (interfaces). Cada plano escala y falla de forma independiente: si la consola web se cae, el motor "
    "sigue detectando; si el motor se reinicia, el sensor almacena en buffer y reintenta. Esta separación "
    "permite distribuir los componentes: el sensor vive en cada endpoint, mientras el motor y las interfaces "
    "pueden centralizarse en un servidor de análisis. La Figura 1 muestra los estratos funcionales y el flujo "
    "de datos de arriba abajo, con la capa de salidas actualizada a los conectores reales del árbol.")

story += figure("docs/assets/diagram_arquitectura.png",
                "Figura 1. Arquitectura por capas del framework: sensor, transporte, motor de detección y "
                "salidas (webhook, notificaciones, SIEM nativo, respuesta activa, consola y API).", 265)

story += h2_block("2.1 Flujo de datos extremo a extremo", para(
    "El recorrido de un evento es siempre el mismo. El kernel emite notificaciones a través de los proveedores "
    "ETW de Windows (Kernel-Process y opcionalmente Sysmon como ruta de ingesta alternativa). El sensor Rust "
    "las consume en tiempo real mediante una sesión de trazado en user-mode, sin driver propietario, y las "
    "traduce al esquema de eventos unificado del capítulo 4. Un buffer acotado absorbe los picos de telemetría "
    "y el transporte las envía por TCP en formato NDJSON al puerto de ingesta (127.0.0.1:7777 por defecto). "
    "Desde la primera conexión, el sensor debe autenticarse con el token compartido del despliegue (comando "
    "AUTH sobre el canal, comparación en tiempo constante); la rotación del token está soportada nativamente "
    "aceptando el token previo durante una ventana de transición, de modo que una rotación de credenciales no "
    "requiere reinicio coordinado de la flota."))
story.append(para(
    "En el motor, cada evento pasa por la ingesta (parseo, validación y truncado de campos en el punto único "
    "de normalización), el enriquecedor (contexto de host y usuario, añadido en un mapa aparte que nunca muta "
    "la evidencia cruda) y el motor de reglas, que evalúa las condiciones YAML indexadas por tipo de evento y "
    "recargadas desde disco cada quince segundos. Sobre esa columna vertebral operan tres detectores "
    "adicionales: el correlador de secuencias multi-etapa por host, el detector de beaconing sobre la "
    "regularidad de las conexiones salientes y el detector de umbrales volumétricos por ventana fija. El "
    "scoring de riesgo agrega la severidad de lo detectado por host con decaimiento temporal. Las alertas "
    "resultantes se publican simultáneamente en la API HTTP local (puerto 7778, con stream SSE para la "
    "consola), el webhook configurable hacia SIEM/SOAR, los canales de notificación externa, los sumideros "
    "SIEM nativos, el almacén SQLite opcional y los comandos de exportación JSONL/CSV. El canal de salida "
    "aplica además deduplicación, supresiones operador-local con expiración y estados de triaje persistidos; "
    "y la API expone, para quien la arme expresamente, la única acción destructiva del sistema: la respuesta "
    "activa del apartado 3.6."))

story += h2_block("2.2 Decisión de lenguaje: Go y Rust juntos", para(
    "La combinación Go más Rust asigna a cada lenguaje el trabajo para el que es mejor. Rust protege el plano "
    "caliente del sensor: consume ETW a decenas de miles de eventos por segundo sin pausas de garbage "
    "collector y con garantías de seguridad de memoria en un componente que corre con privilegios altos; el "
    "binario se compila con LTO y strip, y se niega a ejecutarse fuera de Windows en lugar de inventar "
    "telemetría. Go acelera el desarrollo del motor y sus interfaces: goroutines y channels modelan "
    "naturalmente el pipeline de eventos, y la elección deliberada de la stdlib (net/http para la API, cobra "
    "para la CLI, bubbletea para el panel interactivo) mantiene el binario único, sin CGO y trivial de "
    "desplegar. El contrato entre ambos mundos es el esquema de eventos y el protocolo de transporte, no el "
    "código compartido, lo que mantiene los binarios independientes."))

story += make_table(
    ["Componente", "Lenguaje", "Justificación técnica"],
    [
        ["Sensor / collector", "Rust",
         "Sin pausas de GC en el camino crítico de telemetría; ferrisetw para las sesiones ETW (dependencia "
         "solo-Windows); binario estático con LTO y strip para despliegue masivo; honestidad de plataforma: "
         "rechaza ejecutarse donde no hay telemetría real."],
        ["Motor de detección", "Go",
         "Concurrencia nativa (channels/select) para el pipeline; binario único CGO-free; stdlib net/http "
         "para la API; cobra para la CLI; modernc.org/sqlite (driver puro) para el store opcional; "
         "bubbletea/lipgloss para el panel interactivo."],
        ["Consola web", "TypeScript",
         "Next.js 16 + React 19 + Tailwind 4 para la cabina de operaciones; el hub console-service (Bun + "
         "socket.io) hace de puente con estado de sesión hacia la API del motor."],
        ["Landing pública", "TypeScript",
         "website/ (Next.js 16 + Tailwind 4 + shadcn/ui): página oficial del proyecto con su propio lockfile; "
         "sin datos de telemetría ni andamios heredados tras la limpieza de la ronda 17h55."],
        ["Extensiones (filaments)", "Python",
         "Runtime embebido con sandbox para scripts de análisis en fases futuras; la comunidad de analistas "
         "vive en Python. No implementado aún (fase 4)."],
    ],
    [0.17, 0.13, 0.70],
    "Tabla 2. Asignación de lenguaje por componente y su justificación.")

# ---- 3. Componentes Principales ----
story += h1_block(3, "Componentes Principales",
    "Este capítulo describe las responsabilidades internas de cada bloque de la Figura 1. El criterio de "
    "reparto es simple: un componente, una razón para cambiar. El sensor solo habla con el kernel y el "
    "transporte; el motor solo habla con eventos, reglas y detectores; las interfaces solo hablan con alertas "
    "y datos. Los dieciocho paquetes internos de Go delimitan esas fronteras, y cada paquete nuevo que "
    "introduce estado de larga vida hereda las mismas obligaciones: límites duros de memoria, telemetría de "
    "sus contadores y pruebas de contención con -race.")

story += h2_block("3.1 Sensor (Rust, Windows ETW) y devsensor", para(
    "El sensor abre una sesión ETW por proveedor y consume los callbacks en hilos dedicados. Cada registro se "
    "mapea al esquema unificado sin enriquecimiento pesado: el sensor es rápido y tonto a propósito, porque "
    "cada microsegundo que gasta aquí es un microsegundo robado al endpoint monitorizado. Un buffer de "
    "capacidad fija absorbe picos; si el consumidor remoto se cae, el sensor aplica back-pressure, marca la "
    "pérdida y se reconecta con reintento exponencial. La misma honestidad de plataforma se aplica al "
    "empaquetado: el crate compila en cualquier sistema operativo (normalización y transporte son portables), "
    "pero el binario real se niega a arrancar fuera de Windows en lugar de fabricar datos. Junto al sensor "
    "real, el repositorio mantiene devsensor, un generador de eventos para desarrollo y verificación que "
    "reproduce escenarios ofensivos canónicos y admite un modo de ráfaga (-burst) para ejercitar los umbrales "
    "volumétricos; todo fixture sintético está etiquetado como demo en la propia consola, de modo que nunca se "
    "confunde telemetría de laboratorio con evidencia de producción."))

story += h2_block("3.2 Motor de detección (Go): pipeline y paquetes A1-A4", para(
    "El motor se organiza en cinco etapas encadenadas por canales tipados. La ingesta acepta conexiones de "
    "múltiples sensores, valida cada evento contra el esquema y aplica los techos de truncado en el punto "
    "único de normalización de identidad. El enriquecedor añade contexto sin mutar la evidencia. El motor de "
    "reglas mantiene un índice por tipo de evento y evalúa solo las reglas candidatas. El correlador construye "
    "secuencias con ventana temporal (maxspan) para ataques multi-etapa. El gestor de alertas deduplica, "
    "asigna severidad y dispara las acciones configuradas: log estructurado, notificación a la consola vía "
    "SSE, webhook, canales externos o persistencia en el store. Sobre ese esqueleto, el roadmap del "
    "propietario organizó cuatro paquetes de detección con ciclo de vida completo, resumidos en la tabla 3."))

story += make_table(
    ["Paquete", "Nombre", "Qué añade", "Verificación"],
    [
        ["A1", "Riesgo por host",
         "Score de riesgo decaído por host, ponderado por severidad con vida media de 30 minutos; alimenta "
         "el KPI de hosts calientes en stats, métricas Prometheus y consola.",
         "E2E propia + auditoría cruzada de 04; -race limpia."],
        ["A2", "Umbrales volumétricos",
         "Detección de ventana fija por clave (regla, host, valor de agrupación) con cuota híbrida de estado "
         "(8 192 claves globales, 2 048 por regla), expulsión weakest-first, cooldown por clave y recarga en "
         "caliente; nunca alimenta el correlador.",
         "E2E 12/12 sobre binarios reales; dictamen vinculante de 04."],
        ["A3", "Beaconing (C2)",
         "Detector de regularidad temporal (coeficiente de variación) sobre network.connect con perfiles "
         "conservadores, anillo acotado y cooldown; chokepoint del ingest con techo de destino (253 runes).",
         "E2E 14/14; cross-review con 3 defectos corregidos."],
        ["A4", "Importación Sigma",
         "Convertidor determinista Sigma → formato nativo (mapeo de 19 campos, 7 categorías de logsource, "
         "gramática de condiciones and/or/1-of/all-of), fail-loud por regla y procedencia preservada.",
         "Round-trip con el cargador de reglas; E2E 10/10."],
    ],
    [0.08, 0.17, 0.50, 0.25],
    "Tabla 3. Paquetes de detección del roadmap con su verificación (todos aterrizados).")

story += h2_block("3.3 Consola web y API", para(
    "La consola es la gran diferencia de experiencia frente a la CLI y está construida como una cabina de "
    "operaciones sobre Next.js 16 + React 19 + Tailwind 4. Sus vistas cubren el ciclo completo del analista: "
    "dashboard en vivo con siete KPIs y línea de actividad del sensor, cola de alertas con triaje (reconocida, "
    "cerrada y notas que se persisten en el fichero de lifecycle del motor), gestor de reglas cargadas con sus "
    "tags ATT&CK, vista de cadenas detectadas por el correlador, la vista de respuesta activa — estado de "
    "la superficie y cola de intentos del audit con su filtro por clase, ventana controlable y exportación "
    "JSONL de la cola visible, solo lectura por diseño — y vista de supresiones con "
    "cuenta atrás de expiración. El menú de exportación descarga la evidencia en JSONL o CSV con "
    "neutralización de inyección "
    "de fórmulas. La densidad visual es deliberada: un SOC que mira la pantalla ocho horas al día necesita "
    "información, no decoración, y por eso los efectos ambientales son sutiles, respetan "
    "prefers-reduced-motion y nunca compiten con los datos."))
story.append(para(
    "Arquitectónicamente, la consola no habla con el motor en su tiempo real: el hub console-service (Bun + "
    "socket.io) media la sesión, agrega el stream de alertas y expone una única superficie de tiempo real al "
    "navegador, lo que permite reconexiones limpias y desplegar la consola sin exponer el motor más allá de su "
    "API local; las lecturas puntuales de la vista de respuesta activa son la excepción declarada (acta "
    "18h20): fluyen por el proxy same-origin de la consola y no añaden al hub un segundo camino que la "
    "arquitectura actual no consume. La API REST del motor (net/http, puerto 7778) expone los mismos datos "
    "con un spec OpenAPI (docs/api/openapi.yaml) que un guard de CI valida contra el motor vivo en cada "
    "ronda: hoy son 15 rutas — las trece anteriores más las dos lecturas de respuesta activa — y 36 campos "
    "de estadísticas con paridad exacta entre /api/stats y /metrics, con 74 referencias internas resueltas; "
    "el guard además porta su propio self-test (un fixture positivo y trece negativos que deben producir "
    "hallazgo). El proyecto añadió además website/, la landing oficial en Next.js 16, separada de la consola "
    "y sin acceso a telemetría; la batería TypeScript de la casa cubre hoy los tres paquetes TS del árbol en "
    "el alcance que cada uno define. La Figura 2 muestra el dashboard con telemetría real del sensor de "
    "desarrollo y el panel de hosts calientes completo, regenerada desde el stack real (sensor, hub y "
    "consola de producción); su navegación procede del árbol 091986c y por tanto precede a la ola de "
    "consola de C3 — la limitación viaja declarada en el propio pie de figura."))

story += figure("docs/assets/console-panel.png",
                "Figura 2. Dashboard de operaciones de la consola: KPIs, actividad del sensor, cola de "
                "triaje en vivo y panel de hosts calientes completo. Captura regenerada sobre el árbol "
                "091986c: la navegación capturada precede a la ola de consola de C3 (cb33da6), de modo que "
                "la vista de respuesta activa no figura aún en el menú — declarado como O2 en el acta "
                "18h50_B; la recaptura sobre el árbol vigente queda pendiente.", 300)

story += h2_block("3.4 Extensiones (filaments, fase futura)", para(
    "Los filaments heredan la idea de Fibratus de extensiones en Python, con dos mejoras de diseño: ejecución "
    "en un entorno aislado con recursos limitados y una API de host que exponga el estado del motor "
    "(consultar eventos recientes, pedir enriquecimiento) en lugar de solo callbacks. Cada filament declarará "
    "sus triggers por tipo de evento y devolverá hallazgos con el mismo formato que las reglas nativas, de "
    "forma que la consola y los conectores no distingan su origen. Este bloque se documenta aquí por "
    "honestidad de diseño, no por capacidad: forma parte de la fase 4 del roadmap y no existe código suyo en "
    "el repositorio, porque el proyecto no entrega funciones simuladas."))

story += h2_block("3.5 Salidas externas: webhook, notificaciones (C2) y sumideros SIEM nativos", para(
    "Las alertas del motor no viven solo en la consola: tres familias de conectores las llevan a donde el "
    "operador ya trabaja, y todas comparten la misma disciplina de casa — colas acotadas con techo duro, "
    "reintentos con backoff y credenciales fuera del árbol de configuración. El webhook de alertas "
    "(internal/webhook) entrega cada alerta como JSON firmado con un token Bearer saliente (SF_WEBHOOK_TOKEN) "
    "hacia el receptor que el operador configure, con reintentos y entrega como mínimo una vez. Las "
    "notificaciones externas (internal/notify, ciclo C2) añaden los canales que un SOC real mira en el móvil: "
    "Slack, Telegram y email STARTTLS, cada uno con su propia cola acotada para que un receptor lento nunca "
    "atrase al pipeline de detección, y con los secretos resueltos por variables de entorno (token_env, "
    "username_env, password_env) en lugar de literales en el YAML."))
story.append(para(
    "Los sumideros SIEM nativos (internal/siem) cierran la distancia que quedaba con los plataformas de "
    "retención: Elasticsearch via Bulk API con índice diario determinista e _id estable, y Splunk via HEC "
    "(/services/collector/event), ambos con spools acotados en disco para que un SIEM caído no consuma memoria "
    "del motor. La clase del defecto #30 se cerró en este paquete: ningún log imprime la URL cruda del sink — "
    "la URL puede llevar userinfo de proxy o tokens en el path — sino una etiqueta saneada (esquema y host) y, "
    "para los errores de red, solo la causa (sink endpoint: connection refused). El mismo criterio que la "
    "resto de superficies de salida aplica a las copias de saneado: paquetes desacoplados con su copia local "
    "hasta que aparezca la cuarta y se promueva a compartido. El contrato de fallos es explícito: un error de "
    "construcción del lote o un 4xx que no sea 429 es permanente (el lote no se reencola), el 429 y los fallos "
    "de red son transitorios con backoff, y requireHTTPScheme falla ruidoso en el arranque si el sink no "
    "declara esquema — http se permite y queda documentado como decisión del operador, con el aviso expreso de "
    "que las credenciales viajan en cabeceras pero los cuerpos de alerta cruzan la red en claro."))

story += h2_block("3.6 Respuesta activa (C3, opt-in): kill_process auditado", para(
    "La respuesta activa es la única superficie destructiva del framework y se diseñó con el mismo estándar "
    "que las superficies de credenciales: dictamen de seguridad antes del aterrizaje, ocho restricciones "
    "vinculantes (R1-R8) y verificación falsable. La ruta POST /api/respond/kill solo existe cuando el motor "
    "arranca con -allow-kill, y armarla exige además un token de API y un fichero de auditoría abierto: sin "
    "cualquiera de las tres capas, la ruta responde un 404 real, no un 403 negociable. La acción es "
    "deliberadamente estrecha — SIGKILL fijo sobre un proceso local verificado (pid + nombre + inicio de "
    "coincidencia), nunca un arbitraje de comandos — y un techo global de veinte intentos por minuto acota el "
    "daño que un operador confundido puede infligir a su propia flota."))
story.append(para(
    "La auditoría es la superficie probatoria del mecanismo y se trata como tal: JSONL append-only con fsync "
    "por línea, un intento por línea (concedido o denegado), techo de 64 MiB con semántica "
    "audit_unavailable — alcanzado el techo, todo intento se deniega en lugar de escribir sin registro, porque "
    "el dictamen Q4 lo dejó escrito: sin respuesta es preferible a respuesta sin auditoría — y rotación como "
    "tarea del operador, nunca automática. Quien puede invocar la acción queda acotado por dos listas "
    "versionadas con el mismo contrato de configuración del resto de la casa: -respond-operators (quién puede "
    "actuar; fichero ausente = todo denegado) y -respond-protected (qué no puede matarse jamás: wininit, "
    "services, lsass y los que el operador añada), ambas con entradas acotadas y saneadas para que un fichero "
    "hostil no pueda colar caracteres de control en las líneas de auditoría. El canal Windows se "
    "auto-certificó con su propio hallazgo antes del aterrizaje y la re-revisión de 04-B no abrió defectos "
    "nuevos; la implementación paralela de 02-A (ronda 17h50) convergió de forma independiente con el mismo "
    "test rojo y las mismas decisiones, evidencia de que las restricciones son replicables y no accidentales."))
story.append(para(
    "La iteración primera de C3 cerró su círculo con la superficie de lectura (acta de implementaciones "
    "18h20): dos rutas GET exponen el estado y la cola del audit sin abrir ninguna puerta de escritura "
    "nueva. GET /api/respond/state reporta el armado, la señal fija, los recuentos vivos de operadores y "
    "protegidos — vivos porque la recarga en caliente de quince segundos los cambia bajo un motor corriendo "
    "—, las rutas armadas al arranque y la salud del audit (tamaño del fichero contra su techo de 64 MiB). "
    "GET /api/respond/audit?limit=N devuelve la cola del JSONL del registro más reciente hacia atrás, con el "
    "esquema íntegro del registro probatorio — incluido el nombre real de proceso resuelto —, límite por "
    "defecto de 100 y techo de 500 que satura como el resto de lecturas de la casa. El lector respeta el "
    "contrato append-only por el lado de lectura: nunca bloquea, trunca ni reescribe el fichero, y su "
    "recuento del barrido es honesto — las líneas rotas por un append concurrente o malformadas se cuentan "
    "(skipped) y jamás se sirven como datos, y los registros fuera de la ventana de lectura se marcan "
    "(truncated) en lugar de esconderse —; la prueba de concurrencia en vivo (escritura y lectura "
    "simultáneas bajo -race) verifica que ninguna línea a medio escribir emerge jamás como registro. El "
    "contrato del apartado 2.1 se extiende a las lecturas: con la superficie desarmada, ambas rutas "
    "responden el mismo 404 real byte-idéntico a una ruta desconocida, tras el mismo bearer que el resto "
    "de /api — el audit nombra operadores y direcciones cliente, y su visibilidad se cobra bajo la misma "
    "credencial."))
story.append(para(
    "La consola cierra el ciclo detectar-actuar-ver desde su vista de respuesta activa, solo lectura por "
    "diseño (R8: el kill no tiene disparador de UI). La tarjeta de superficie muestra el armado con su "
    "señal, los recuentos vivos con sus rutas y la barra de salud del audit con aviso al 80 % del techo — "
    "el mismo mensaje de rotación que canta el banner del motor —; la cola de intentos distingue ejecutado "
    "de denegado con su código de denegación, muestra el nombre real resuelto cuando la plataforma lo "
    "corrigió, el mecanismo empleado, con su fallback_reason visible como etiqueta junto al mechanism "
    "cuando hubo degradación, el seguimiento marcado y el identificador de acción que une la "
    "respuesta API con su línea JSONL y su entrada de log. Los estados vacíos son honestos: sin superficie "
    "armada la vista declara no disponible con las tres condiciones de armado al pie, y un audit sin "
    "intentos muestra su estado vacío real, nunca una tarjeta fabricada."))
story.append(para(
    "La ola de operabilidad forense (4967cad, acta 02-B 19h25) llevó la vista del plano de lectura al "
    "plano de trabajo del operador que investiga con el audit delante. La cola de intentos gana un filtro "
    "por clase — todas, ejecutadas, denegadas y followups —, donde el followup es una clase propia porque "
    "registra el comprometido-pero-no-aterrizado: la línea que el motor deniega por construcción cuando la "
    "señal falla tras el commit del intento; el conteo de la cabecera es honesto — visible de N en la "
    "ventana, el patrón de la cola de alertas — y un filtro sin coincidencias muestra un estado vacío real "
    "con su acción de quitar filtro, nunca una lista falsamente vacía. La ventana de cola deja de ser un "
    "techo fijo para convertirse en control del operador: cien registros por defecto contra el techo de "
    "quinientos del motor, aplicada por el hook en ambos puntos de lectura — sincronización inicial y "
    "sondeo periódico de dos segundos — de modo que el cambio surte efecto en el siguiente sondeo sin "
    "resuscribir el stream. Y la cola visible se exporta desde el propio cliente en JSONL — una línea por "
    "registro verbatim, el mismo esquema Record que el motor escribe append-only, con tipo "
    "application/x-ndjson — con la honestidad de superficie por bandera: el motor no tiene ruta bulk de "
    "exportación para el audit por diseño (la lectura es una cola acotada), de modo que el botón empaqueta "
    "la ventana visible, el tooltip lo declara y el fichero completo sigue viviendo en el host del motor, "
    "donde nadie lo reescribe; con la cola vacía el botón queda deshabilitado de verdad."))
story.append(para(
    "El mecanismo de ejecución es dual por plataforma y su degradación viaja en el propio registro "
    "probatorio. En Linux la vía preferente es pidfd: el descriptor queda anclado al objeto del proceso, "
    "inmune a la reutilización de PID, y solo cae a la vía de respaldo cuando el kernel no lo soporta "
    "(enosys) o la tabla de descriptores se agota (emfile/enfile — un mecanismo vivo muriéndose de hambre, "
    "digno de alarma). La degradación nunca es silenciosa: la línea de seguimiento del audit y la API "
    "llevan mechanism=fallback junto a fallback_reason con el errno exacto — incluso en los intentos "
    "denegados —, contrato ratificado por dos cross-reviews independientes. En Windows la vía es handle: "
    "un único OpenProcess sirve la verificación del nombre real y la terminación, el objeto queda anclado "
    "mientras el handle vive y la ventana de reciclaje de PID no puede redirigir el kill a otro proceso. "
    "Su certificación es conductual y permanente: el job engine-windows de CI ejecuta el smoke sobre un "
    "motor nativo real — 29 aserciones OK y 0 fallos — con el proceso objetivo muerto vía "
    "mechanism=handle, el cebo csrss.exe sobreviviendo como protegido, cuatro denegaciones 403 con su "
    "código, 401/429/409, la guarda R6 negando antes de senilar, el JSONL íntegro y el 404 real del "
    "desarmado; la condición de cierre de C3 fijada por seguridad dejó así de depender de la memoria de "
    "una ronda y vive en cada corrida de CI — una regresión que la rompa aterriza en rojo."))

# ---- 4. Modelo de Datos y Esquema de Eventos ----
story += h1_block(4, "Modelo de Datos y Esquema de Eventos",
    "El esquema de eventos es el contrato maestro del sistema: lo emiten los sensores, lo validan las "
    "ingestas, lo indexan las reglas y lo consumen las interfaces. Se diseña inspirado en los estándares OCSF "
    "y ECS para que las integraciones SIEM sean casi gratuitas — y los sumideros nativos del apartado 3.5 lo "
    "explotan ya sin transformación intermedia —, pero reducido a los campos que la detección realmente usa. "
    "Cada evento es una línea JSON independiente, lo que hace el transporte trivial (NDJSON), el archivo "
    "forense lineal y el parseo paralelo sencillo. La tabla 4 resume los campos vigentes; respecto a la v0.1, "
    "el esquema incorpora el par proceso-objetivo y el mapa de enriquecimiento separado de la evidencia.")

story += make_table(
    ["Campo", "Tipo", "Descripción"],
    [
        ["id", "uuid", "Identificador único del evento generado por el sensor."],
        ["timestamp", "RFC3339", "Momento de alta resolución del evento en el kernel."],
        ["type", "enum",
         "process.create, process.terminate, process.access, file.write, network.connect, image.load, "
         "registry.set (7 tipos)."],
        ["source", "enum", "etw, sysmon, devsensor, api: origen de la telemetría."],
        ["host", "string", "Hostname del endpoint monitorizado (normalizado y truncado en el ingest)."],
        ["user", "string", "Usuario en cuyo contexto se originó la actividad."],
        ["process.*", "objeto",
         "pid, ppid, name, command_line, image y hashes del proceso; base de los árboles de proceso."],
        ["target.* / access.*", "objeto",
         "Proceso objetivo y detalles de acceso en eventos process.access (p. ej. apertura de LSASS)."],
        ["network.*", "objeto",
         "L4 del evento: protocolo, IP y puerto origen/destino, dominio resuelto (techo de 253 caracteres)."],
        ["file.*", "objeto", "Ruta, extensión y hashes en eventos de fichero."],
        ["registry.*", "objeto", "Clave y valor en eventos de registro de Windows."],
        ["tags", "lista", "Etiquetas libres: attack.t1059.001, hunting, demo, filament:nombre."],
        ["enrichment", "mapa",
         "Contexto añadido por el motor (nunca por sensores); vive aparte y nunca muta los campos de "
         "evidencia cruda."],
    ],
    [0.16, 0.10, 0.74],
    "Tabla 4. Campos del esquema de eventos unificado (v0.7).")

story += code_block([
    '{',
    '  "id": "3f2a1c9e-8b4d-4f7a-9c21-7d0e5b6a1f88",',
    '  "timestamp": "2026-09-30T14:22:31.482119Z",',
    '  "type": "process.create",',
    '  "source": "devsensor",',
    '  "host": "LAB-WKS-01",',
    '  "user": "CORP\\\\jdoe",',
    '  "process": {',
    '    "pid": 6612, "ppid": 4820,',
    '    "name": "powershell.exe",',
    '    "command_line": "powershell.exe -nop -w hidden -enc SQBFAFgA...",',
    '    "image": "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe"',
    '  },',
    '  "tags": ["demo", "parent:winword.exe"]',
    '}',
], "Ejemplo 1. Evento process.create en formato NDJSON (transporte y archivo forense).")

story += h2_block("4.1 Pipeline de enriquecimiento y límites del ingest", para(
    "El enriquecimiento ocurre después de la ingesta y antes de la evaluación de reglas, de modo que las "
    "reglas pueden condicionar sobre campos enriquecidos igual que sobre campos crudos. Los pasos son "
    "idempotentes y configurables: resolución de usuario y host y anotaciones de contexto que aterrizan en el "
    "mapa enrichment. Cada paso añade información sin mutar los campos originales del sensor, preservando la "
    "evidencia cruda para el forense. El ingest es además el chokepoint de normalización de identidad: allí "
    "se truncan los campos que los detectores fijan como claves de estado (host, usuario y destino de red con "
    "techo de 253 caracteres, suficiente para cualquier dominio RFC 1123 o IP textual), de modo que un feed "
    "hostil no puede anclar memoria arbitraria en el estado de larga vida de los detectores. Los pasos "
    "costosos trabajan con caché y TTL, porque el enriquecimiento nunca puede ser el cuello de botella del "
    "pipeline de detección."))

# ---- 5. Sistema de Reglas YAML ----
story += h1_block(5, "Sistema de Reglas YAML",
    "El formato de reglas es la interfaz de usuario más importante del framework: es lo que un analista blue "
    "team escribe, lee y mantiene todos los días. Se elige YAML por legibilidad y compatibilidad con control "
    "de versiones, y se reserva la expresividad para un conjunto pequeño y predecible de operadores. Una "
    "regla declara a qué tipo de evento aplica, qué condiciones debe cumplir el evento, qué acciones disparar "
    "al detectar y qué etiquetas MITRE ATT&CK la caracterizan. Las reglas se cargan de un directorio, se "
    "validan al arrancar y se recargan en caliente al detectar cambios en disco (ciclo de quince segundos, "
    "configurable), sin reiniciar el motor ni perder el estado de los detectores. El loader comparte los "
    "techos de la casa del resto de superficies de configuración: 4 MiB por fichero (comprobados antes de "
    "leer), pre-scan de profundidad de anidación y un techo de 2.048 reglas habilitadas, con fallo ruidoso "
    "tanto en el arranque como en cada tick de recarga — un fichero sobredimensionado u hostil aborta el "
    "arranque o conserva el set anterior en caliente, nunca degrada un motor en marcha. El pack embarcado usa "
    "23 de esos 2.048 puestos.")

story += code_block([
    '# rules/windows/powershell_encoded.yaml',
    '# T1059.001 - PowerShell with encoded command',
    '# Validated in lab: fires on powershell.exe -nop -w hidden -enc .',
    '- name: "PowerShell con comando codificado"',
    '  id: "9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40"',
    '  description: >',
    '    Detecta PowerShell con comandos Base64 (-enc / -EncodedCommand) o',
    '    ventana oculta (-w hidden), patron habitual en phishing.',
    '  severity: high',
    '  event_type: process.create',
    '  conditions:',
    '    - field: process.name',
    '      operator: eq',
    '      value: "powershell.exe"',
    '    - field: process.command_line',
    '      operator: contains_any',
    '      value: ["-enc", "-EncodedCommand", "-w hidden"]',
    '  actions:',
    '    - type: alert',
    '      config:',
    '        message: "PowerShell con comando codificado en {host} por {user}"',
    '  tags: ["attack.t1059.001", "attack.execution"]',
    '  enabled: true',
], "Ejemplo 2. Regla real del pack sembrado (T1059.001, PowerShell codificado).")

story += h2_block("5.1 Operadores soportados", para(
    "El conjunto de operadores es deliberadamente minimalista: cada operador nuevo añade superficie de testeo "
    "y de evasión semántica. Con la familia siguiente se cubre la práctica totalidad de las detecciones "
    "orientadas a comportamiento, desde cadenas de procesos hasta acceso a rutas sensibles. Respecto a la "
    "v0.1 de este documento, la lista refleja los diecisiete operadores realmente implementados (once "
    "case-sensitive más la familia insensible i*, llegada con la auditoría de la importación Sigma; el "
    "comparador de rango entre acotado se resolvió con las combinaciones de mayor/menor); los operadores de "
    "secuencia pertenecen al correlador y no al evaluador puntual, y se describen en la misma tabla por "
    "referencia única. La semántica de estos operadores es fuente única: la exportada por rules.NewMatcher "
    "(que consumen el importador Sigma y los umbrales) comparte el mismo código que evalúa el motor, con "
    "pruebas de paridad que impiden divergencias. La familia i* pliega mayúsculas con una única semántica de "
    "folding Unicode compartida por sus seis operadores y por el fallback regex (?i): un valor que pasa ieq "
    "no puede evadir icontains — el caso del long s (U+017F) quedó cubierto por regresión y con benchmarks — "
    "y el coste del camino rápido ASCII no cambia; el peor caso exótico queda por debajo del miss regex."))

story += make_table(
    ["Operador", "Aplica a", "Semántica y ejemplo de uso"],
    [
        ["eq / neq", "cualquier campo",
         "Igualdad o desigualdad exacta. process.name eq \"mimikatz.exe\"; "
         "process.parent.name neq \"explorer.exe\"."],
        ["contains / contains_any", "strings",
         "Subcadena o lista de subcadenas en OR. command_line contains_any [\"-enc\", \"-w hidden\"]."],
        ["startswith / endswith", "strings",
         "Prefijo o sufijo. image endswith \"\\\\rundll32.exe\"."],
        ["regex", "strings",
         "Expresión regular RE2 validada al cargar la regla; longitud limitada para evitar ReDoS."],
        ["in / not_in", "listas",
         "Pertenencia a lista estática o dinámica (feed TI). user in service_accounts."],
        ["gt / lt", "numéricos",
         "Comparación para puertos, tamaños o conteos. network.destination.port gt 4444."],
        ["i* (ieq, icontains, icontains_any, istartswith, iendswith, iin)", "strings / listas",
         "Variantes insensibles a mayúsculas de igualdad, subcadena, prefijo, sufijo y pertenencia; "
         "llegan con la importación Sigma para firmas de caso arbitrario."],
        ["sequence + maxspan", "correlación",
         "Orden de eventos dentro de una ventana temporal por host: process.create de winword.exe seguida "
         "de network.connect externa en maxspan 10s."],
    ],
    [0.24, 0.14, 0.62],
    "Tabla 5. Operadores del motor de reglas y del correlador (17 operadores implementados).")

story += h2_block("5.2 Reglas sembradas desde TTPs ofensivas", para(
    "El pack inicial no nace de catálogos genéricos: cada una de las 23 reglas (en 6 ficheros bajo "
    "rules/windows/) corresponde a una técnica que el autor ha ejecutado o defendido en operaciones reales. "
    "Este origen ofensivo define el detalle de las condiciones, que apuntan a combinaciones de campos y no a "
    "nombres de binarios aislados, y por tanto resisten cambios triviales de nombre o firma. El pack cubre "
    "ejecución ofuscada de PowerShell, descarga con binarios LOLBAS (certutil, bitsadmin), volcado de LSASS "
    "vía comsvcs.dll, movimiento lateral con credenciales, manipulación de persistencia y una regla de host "
    "en tiempo real para patrones de laboratorio."))
story.append(para(
    "Cada regla documenta en su descripción cómo fue validada: qué TTP se ejecutó en laboratorio, qué "
    "eventos generó y qué ruido produce en un host limpio. Esta disciplina de evidencia, heredada de la "
    "práctica ofensiva, es lo que permite que la comunidad confíe y contribuya packs completos por técnica "
    "MITRE. El comando engine validate reporta el estado del pack (OK, avisos y errores) antes de "
    "desplegar, y engine rules presenta la tabla de reglas cargadas con severidad, tipo de evento y tags, "
    "de modo que el operador siempre puede auditar qué está activo y por qué."))

story += h2_block("5.3 Importación de reglas Sigma (A4)", para(
    "El ecosistema Sigma es el estándar de facto de las reglas de detección comunitarias, y reescribirlas a "
    "mano es el mayor coste de adopción de cualquier motor nuevo. El subcomando engine sigma convierte "
    "directivas Sigma al formato nativo de forma determinista: mismo input produce byte a byte el mismo "
    "output, lo que hace las conversiones revisables en diff. El traductor mapea los 19 campos del esquema "
    "Sigma, resuelve 7 categorías de logsource hacia los tipos de evento del motor, traduce la tabla de "
    "wildcards a los operadores nativos con anclaje de regex cuando procede, y soporta la gramática de "
    "condiciones and/or/1-of/all-of, fusionando los OR de un mismo campo y dividiendo los OR entre campos "
    "distintos en reglas separadas. La política de errores es fail-loud y por regla: una directiva con una "
    "selección no soportada se omite con un motivo accionable en el informe, y un fichero roto o desmesurado "
    "es un error duro, nunca una conversión silenciosamente incompleta. Los techos de superficie (512 reglas "
    "de salida, 64 selecciones, 32 campos y 4 MiB por directiva) acotan el recurso consumido por un lote "
    "hostil. La procedencia se preserva: el identificador UUID original y la etiqueta sigma viajan en la "
    "regla convertida, y el proveedor queda anotado en la descripción. La verificación incluye una prueba de "
    "ida y vuelta: cada regla emitida se recarga con el cargador nativo del motor y dispara contra el evento "
    "de laboratorio de su TTP; el E2E completo pasa 10/10 sobre binarios reales."))

story += h2_block("5.4 Control de falsos positivos", para(
    "Un detector que despierta al SOC cada diez minutos termina silenciado, y un silenciador sin control "
    "termina ocultando ataques reales. El canal de salida del motor aplica, en orden: deduplicación por "
    "identidad de alerta, supresiones operador-local (pares regla-host con motivo y expiración opcional, "
    "cargadas de un YAML gitignoreado y armadas también por API con escritura auditada), límites "
    "conservadores por defecto en los detectores volumétricos (severidad medium en el pack de umbrales) y "
    "estados de triaje persistidos para que el trabajo del analista sobreviva a los reinicios. La guía "
    "docs/false-positive-control.md documenta la receta completa, incluida la opción final de filtrar en el "
    "receptor del webhook. La escritura de supresiones por API exige token y se niega en arranques sin él, "
    "porque un endpoint de escritura sin credenciales sería un atajo para un atacante que ya esté dentro de "
    "la máquina del motor."))

# ---- 6. Stack Tecnológico y Estructura del Repositorio ----
story += h1_block(6, "Stack Tecnológico y Estructura del Repositorio",
    "El stack se elige para minimizar fricción en las primeras semanas y para escalar después sin "
    "reescrituras. Se priorizan librerías mantenidas, con licencia permisiva y trazabilidad de rendimiento "
    "publicada. La tabla siguiente fija la decisión técnica por capa del sistema tal como está hoy; las "
    "desviaciones respecto a la v0.1 (stdlib en lugar de Gin y expr, driver SQLite puro en lugar de "
    "go-sqlite3, Next.js en lugar de Vite) se resolvieron a favor de menos dependencias y un binario único "
    "sin CGO.")

story += make_table(
    ["Capa", "Tecnología", "Motivo de la elección"],
    [
        ["Sensor (Rust)", "ferrisetw, serde, anyhow (LTO + strip)",
         "Sesiones ETW simplificadas; binario estático y pequeño; dependencias ETW confinadas a Windows "
         "con compilación portable del resto."],
        ["Motor (Go 1.22)", "stdlib net/http, cobra, bubbletea/lipgloss, yaml.v3, modernc.org/sqlite",
         "Binario único CGO-free; CLI con subcomandos y ayuda generada; TUI para el panel interactivo; "
         "SQLite puro para el forense opcional sin cgo en CI."],
        ["Transporte", "NDJSON sobre TCP + AUTH de token compartido",
         "Depurable con netcat desde el día uno; rotación de token sin reinicio coordinado; gRPC queda "
         "como fase futura si la flota lo exige."],
        ["Consola web", "Next.js 16, React 19, Tailwind 4, socket.io (hub Bun)",
         "Cabina de operaciones con tipado estricto; el hub media la sesión en tiempo real y evita exponer "
         "el motor más allá de su API local."],
        ["Salidas externas", "webhook HTTP, Slack/Telegram/SMTP, Elasticsearch Bulk, Splunk HEC",
         "Colas y spools acotados por conector; credenciales por entorno; saneado de URL en logs (#30); "
         "contrato de fallos permanente/transitorio declarado."],
        ["Almacenamiento", "SQLite (opt-in, WAL) + export JSONL/CSV",
         "Evidencia en endpoint sin instalación; retención con poda automática (72 h por defecto); export "
         "con neutralización de inyección de fórmulas."],
        ["Build y CI", "Make, GitHub Actions (SHA-pinned), Docker",
         "Un comando para compilar todo; guard del OpenAPI contra el motor vivo (15 rutas, 36 campos, "
         "74 referencias, self-test incluido); bench nocturno con dos pasadas y sonda fsync; baterías Go y TS por paquete."],
    ],
    [0.15, 0.33, 0.52],
    "Tabla 6. Stack tecnológico por capa con su justificación (v0.7).")

story.append(para(
    "La estructura del monorepo delimita las fronteras con el sistema de ficheros: cada paquete interno es "
    "un directorio con su batería, y las tres superficies TypeScript (consola, hub y landing) llevan cada "
    "una su package.json con un único lockfile bun.lock. El árbol siguiente corresponde al estado real del "
    "repositorio en el momento de generar esta revisión; el generador versionado (scripts/arq_v04/) es la "
    "pieza que faltaba del pipeline documental y convierte la actualización de este documento en un comando "
    "reproducible en lugar de una edición a mano."))

story += code_block([
    'security-framework/',
    '├── cmd/                    # engine (run/rules/validate/sigma/TUI), devsensor, bench',
    '├── internal/               # 18 paquetes delimitados por frontera',
    '│   ├── ingest/ enrich/ rules/ correlate/ beacon/ threshold/ risk/ sigma/',
    '│   ├── alert/ actions/ webhook/            # alertas, acciones, conector saliente',
    '│   ├── notify/ siem/                       # C2: Slack/Telegram/email · SIEM nativo',
    '│   ├── respond/                            # C3: respuesta activa auditada',
    '│   ├── api/ store/ suppress/ lifecycle/    # API, SQLite, supresiones, triaje',
    '├── pkg/model/              # esquema de eventos compartido',
    '├── sensor/                 # sensor ETW en Rust',
    '├── rules/windows/          # 23 reglas sembradas (6 ficheros)',
    '├── sequences/ beacons.yaml thresholds.yaml suppressions.example.yaml',
    '├── web/console/            # consola Next.js 16 (lockfile propio)',
    '├── web/console-service/    # hub Bun + socket.io (lockfile propio)',
    '├── website/                # landing oficial Next.js 16 (lockfile propio)',
    '├── scripts/dev-tests/      # E2E y smokes sobre binarios reales + guard OpenAPI',
    '├── scripts/windows/        # instalador PS1, servicio, config Sysmon',
    '├── scripts/arq_v04/        # este generador (pipeline versionado del documento)',
    '└── docs/                   # este documento, OpenAPI, assets, actas',
], "Ejemplo 3. Estructura del monorepo (v0.7, árbol real del repositorio).")

story.append(para(
    "Las convenciones de código se aplican desde el primer commit: formato obligatorio (gofmt y rustfmt), "
    "vet y lint en CI, commits convencionales y documentación de decisión viva (este documento, el README y "
    "los informes de ronda). Todo paquete recibe pruebas unitarias antes de fusionarse, y la batería de E2E "
    "de scripts/dev-tests ejercita los binarios reales de punta a punta para detectar regresiones de "
    "detección, no solo de compilación. Los paquetes que introducen estado de larga vida se auditan además "
    "con -race y con pruebas de contención de memoria, una convención que el rol de seguridad elevó a "
    "estándar del equipo tras las auditorías de los detectores. La batería TypeScript replica el criterio "
    "por paquete: bun test + tsc --noEmit + next build en consola y hub, y en la landing el mínimo que su "
    "propio package.json define (lockfile sin deriva, eslint y build de producción)."))

# ---- 7. Roadmap de Desarrollo ----
story += h1_block(7, "Roadmap de Desarrollo",
    "El roadmap se organiza en cuatro fases, cada una con un entregable demostrable al cierre. La regla de "
    "priorización es explícita: primero el flujo vertical que detecta (tracer bullet), después la anchura de "
    "telemetría y la detección avanzada, después la experiencia, y solo al final la extensibilidad. La tabla "
    "7 añade a la planificación original la columna que la v0.1 no podía escribir: el estado real verificado "
    "de cada fase a fecha de esta revisión. Los contadores citan su procedencia — el marcador de defectos y "
    "las líneas de roadmap cerradas se consolidan en las actas del Director y del rol de seguridad, no en "
    "este documento — y hoy marcan 13 de 17 líneas cerradas y 33 defectos cerrados sin ninguno vivo en el "
    "marcador canónico. La condición de cierre de la respuesta activa es ya permanente en CI sobre motor "
    "Windows nativo; la catorceava línea del roadmap, la consola de respuesta activa, sigue figurando como "
    "propuesta del acta de implementaciones 18h20 a la espera de la certificación del Director; y los "
    "hallazgos posteriores avanzan con su estado declarado — F1 cerrada: su parche de keys compuestas "
    "quedó certificado por el cross-review de seguridad (acta 19h30) junto con la etiqueta "
    "fallback_reason de O2 conforme al contrato R7b —, F2 con parche listo en el carril 02-A, y #34 y #35 "
    "propuestos por seguridad, estos tres sin baja certificada aún.")

story += make_table(
    ["Fase", "Objetivos", "Estado hoy (v0.7)"],
    [
        ["1. Core y MVP (Q4 2026)",
         "Tracer bullet end-to-end; sensor básico; reglas YAML puntuales; CLI de prueba.",
         "Aterrizada y medida: pipeline completo, 23 reglas, ingest autenticado, p99 ≈ 0,4 ms medido con "
         "bench (promesa original: < 10 ms)."],
        ["2. Detección avanzada (Q1 2027)",
         "Correlación de secuencias; almacenamiento forense; YARA; eBPF para Linux.",
         "Mayormente aterrizada: correlador con cap de estado, store SQLite con retención, beaconing (A3), "
         "umbrales (A2) y riesgo (A1). YARA y eBPF siguen pendientes."],
        ["3. Experiencia (Q1-Q2 2027)",
         "Consola web con dashboard en vivo; API documentada; conectores Elastic/Splunk.",
         "Casi cerrada: consola Next.js de operaciones, OpenAPI validado por guard en CI, webhook "
         "SIEM/SOAR, notificaciones externas (C2), sumideros SIEM nativos Elastic/Splunk aterrizados y "
         "respuesta activa C3 certificada y observable de punta a punta (detectar, actuar y leer el audit "
         "desde la API y la consola), con su cierre conductual permanente en CI sobre motor Windows nativo. "
         "Queda el pulido de empaquetado de conectores."],
        ["4. Extensibilidad (Q2 2027)",
         "Filaments en sandbox Python; profiling; guía de contribución.",
         "Pendiente. Sin código simulado en el árbol; el diseño se mantiene en la sección 3.4."],
    ],
    [0.17, 0.33, 0.50],
    "Tabla 7. Fases del roadmap con su estado real a septiembre de 2026 (v0.7).")

story.append(para(
    "Las métricas de éxito miden la salud del proyecto, no solo el código. La fase 1 prometía un pipeline "
    "estable con latencia p99 bajo diez milisegundos: el bench nocturno mide hoy 0,4 milisegundos en el "
    "peor de los casos medidos sobre loopback, con completitud 2000/2000 de alertas muestreadas en el mismo "
    "reloj. El bench corre además en dos pasadas comparativas por corrida: la baseline de anillos y una "
    "segunda idéntica con la store SQLite acoplada. Las corridas hasta la fecha registran p99 de anillos "
    "entre 334 y 550 µs y con store entre 870 y 929 µs — sobrecargas entre +358 µs y +595 µs (+65 % a "
    "+178 %) según la clase de runner (el fsync del disco cambia el cuadre, y la corrida registra la sonda "
    "fsync 4k dsync del mismo medio como dato de la corrida) —, registradas como dato, no como veredicto, "
    "con ambas pasadas muy dentro del contrato. Para las fases 2 y 3 siguen en pie los umbrales de "
    "cobertura de telemetría, el tiempo de instalación bajo cinco minutos y los primeros usuarios externos "
    "emitiendo feedback en el tracker. La estrategia de comunidad acompaña al producto desde el día uno: "
    "documentación de arranque en diez minutos, casos de uso por técnica MITRE y una etiqueta "
    "good-first-issue siempre abierta."))

# ---- 8. Plan de Acción y Verificación ----
story += h1_block(8, "Plan de Acción y Verificación",
    "El tracer bullet que acompañó a la v0.1 sigue siendo la puerta de entrada al proyecto: un disparo "
    "vertical completo que valida la arquitectura antes de construir sobre ella. Su valor no es funcional "
    "sino de riesgo: demuestra que el esquema de eventos, el protocolo de transporte, el motor de reglas y "
    "las alertas encajan, y lo hace hoy, en cualquier máquina con Go instalado, sin depender de Windows. La "
    "Figura 3 muestra el flujo de los cinco pasos que ejecuta el andamiaje.")

story += figure("docs/assets/diagram_tracer.png",
                "Figura 3. Tracer bullet: pipeline de evento a alerta ejecutable en cualquier plataforma.",
                200)

story += h2_block("8.1 Ejecutar el tracer bullet", para(
    "El motor arranca en una terminal y escucha por TCP en el puerto 7777; el sensor de desarrollo genera "
    "en otra terminal eventos de proceso simulados, algunos benignos y otros emulando PowerShell codificado "
    "o descargas con certutil; con -burst añade ráfagas de escritura que disparan los umbrales volumétricos. "
    "En segundos la consola muestra las alertas disparadas con severidad y la telemetría cruda en formato "
    "JSON estructurado. El mismo flujo, cambiando el devsensor por el binario Rust en un host Windows, "
    "consume ETW real: el motor no sabe la diferencia porque el contrato es el esquema de eventos. La "
    "importación de un pack comunitario cierra el círculo con dos comandos."))

story += code_block([
    '# 1. Arrancar el motor (terminal 1)',
    'make run-engine',
    '# -> ingest :7777 con AUTH, API :7778, reglas + secuencias + beacons + umbrales',
    '',
    '# 2. Generar eventos (terminal 2)',
    'make run-devsensor          # escenario canónico + etiqueta demo',
    'sf-devsensor -burst 60      # rafaga para el detector de umbrales (A2)',
    '',
    '# 3. Resultado esperado',
    '# [ALERT] HIGH T1059.001 powershell.exe -enc ...   host=LAB-WKS-01',
    '',
    '# 4. Importar reglas Sigma de la comunidad',
    'sf-engine sigma -dir sigma-rules/ -out rules/imported/ -strict',
], "Ejemplo 4. Comandos del tracer bullet y del importador Sigma.")

story += h2_block("8.2 Verificación continua", para(
    "La verificación no es una fase final sino parte del ciclo de cada ronda. La batería de "
    "scripts/dev-tests ejercita binarios reales de punta a punta: e2e_sigma (10/10, incluida la salida "
    "estricta con código 1), e2e_threshold (12/12, incluido el respeto de supresiones sobre alertas "
    "volumétricas), e2e_beacon (14/14, incluida la verificación anti-re-vinculación de puertos), e2e_risk_a1 "
    "(23/23, scoring exacto con banda de decay, dedup por repetición y paridad contra /api/stats), "
    "e2e_siem (19/19 x2, incluida la Fase 0 que demuestra el echo de URLs saneadas y el contrato 4xx "
    "permanente/transitorio sobre un sink real), e2e_respond_kill (23/23, incluida la fase que ejercita las "
    "lecturas state/audit sobre binarios reales y el 404 real en desarmado), smoke_auth, smoke_lifecycle y "
    "e2e_store_sequences; el smoke_respond suma 29 aserciones sobre motor Windows nativo en CI — el cierre "
    "conductual permanente de C3: mechanism=handle con proceso real muerto, el cebo csrss.exe sobrevive "
    "como protegido y el desarmado mantiene su 404 real byte-idéntico. El guard del OpenAPI compara el "
    "spec con el motor vivo (15 rutas y 36 campos "
    "de stats, con paridad exacta "
    "contra /metrics) y falla la ronda si hay deriva; su self-test verifica al propio guard con un fixture "
    "positivo y trece negativos que deben producir hallazgo. Los paquetes con estado se testean con -race "
    "— seis paquetes, respond incluido desde su aterrizaje —, y el bench nocturno (cron 02:30 UTC, "
    "disparable a mano) cierra el círculo de rendimiento con dos pasadas comparativas por corrida y "
    "presupuesto de latencia asesor, no bloqueante: solo la pérdida de alertas pone la corrida en rojo."))
story.append(para(
    "La batería TypeScript sigue el mismo estándar de evidencia por conteos en las tres superficies del "
    "árbol: la suite del proxy de la consola (10/10, 29 aserciones), el hub console-service (50/50, 206 "
    "aserciones) y los cambios en el límite navegador→motor exigen además la matriz conductual en vivo con "
    "un escenario por guarda; la landing website/ aporta lockfile sin deriva, eslint y build de producción "
    "(4/4 páginas estáticas). A partir de aquí, el roadmap del capítulo 7 gobierna las próximas rondas: "
    "iniciar el spike de YARA para escaneo de memoria bajo demanda, explorar el collector eBPF para Linux, "
    "empaquetar los conectores como entrega oficial y publicar el release etiquetado con notas de versión "
    "y demo grabada. La arquitectura descrita en este documento es, sobre todo, una promesa de estabilidad "
    "para quien construya encima: el comportamiento del pipeline no cambiará, solo mejorará su "
    "implementación, y cada revisión futura vendrá acompañada de la misma columna de estado honesto que "
    "distingue a esta v0.7 de su original — generada, además, por el pipeline versionado que este propio "
    "capítulo describe."))

# ------------------------------------------------------------------ build --
doc = TocDocTemplate(
    OUT_BODY,
    pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=MARGIN,
    title="Arquitectura Técnica - Framework de Detección de Amenazas en Tiempo Real (v0.7)",
    author="Ruby570bocadito",
    creator="Ruby570bocadito",
    subject="Documento de arquitectura tecnica v0.7: estado implementado y verificado del framework",
)
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print(f"body written: {OUT_BODY}")
