/* =========================================================
   SISTEMA DE MUEBLERÍA IA - Versión Web Chat Autónoma
   - Basado en Versión Maestro Integrada (Final V5)
   - Handover para consultas técnicas desconocidas
   - Desglose de piezas individuales de combos ("Solo el...")
   - Catálogo visualmente optimizado con espaciado amplio
========================================================= */

const ordenEstados = { nuevo: 0, catalogo: 1, producto: 2, precio: 3, objecion: 4, cierre: 5 };

// --- Utilidades ---
function limpiarMensaje(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") return "";
  let cleaned = rawMessage.replace(new RegExp("Headline:.*?\\n", "gi"), "").replace(new RegExp("Source URL:.*?\\n", "gi"), "").replace(/Message Details/gi, "").trim();
  return cleaned;
}

function normalizarTextoGlobal(str) {
  if (!str) return "";
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").replace(/z/g, "s").trim();
}

function normalizarEntradaAvanzada(texto) {
  let t = normalizarTextoGlobal(texto);
  const sinonimos = { "closet": "ropero", "placard": "ropero", "guardarropa": "ropero", "chilero": "bonito", "peinador": "marquesa", "tocador": "marquesa", "marqueza": "marquesa", "matrimonial": "matri", "cosina": "cocina" };
  Object.keys(sinonimos).forEach(key => { t = t.replace(new RegExp("\\b" + key + "\\b", "g"), sinonimos[key]); });
  return t;
}

// --- DB Mock/Wrappers (Usando KV) ---
async function getProductList(env) {
  try {
    const raw = await env.PRODUCTS_DB.get("productos:listado");
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

async function obtenerRespuestaCoverage(texto, env, state) {
  try {
    const listadoRaw = await env.COVERAGE_DB.get("coverage:listado");
    const listado = JSON.parse(listadoRaw || "[]");
    const m = normalizarTextoGlobal(texto);
    for (const item of listado) {
      const u = normalizarTextoGlobal(item.ubicacion);
      if (u.length > 3 && m.includes(u)) return item.respuesta;
    }
    const pideUbicacion = /(donde|ubica|envio|flete|entrega|cobertura|llegan|mandan|lugar|municipio|departamento|entregan)/i.test(m);
    if (pideUbicacion && !state.esperando_departamento) {
        state.esperando_departamento = true;
        let munLimpio = m.replace(/(donde|ubica|envio|flete|entrega|cobertura|llegan|mandan|lugar|muebles|hacia|para|en|a|la|el|los|las|municipio|departamento|entregan|realizan|entrega)/gi, "").trim();
        state.municipio_pendiente = munLimpio;
        return "[PREGUNTAR_DEP] Lo siento, para ubicarle de mejor manera y brindarle la información de entrega exacta, ¿podría indicarme a qué departamento pertenece el lugar donde se encuentra? 😉";
    }
    if (state.esperando_departamento) {
        const depInput = m;
        const depMunRaw = await env.COVERAGE_DB.get("listado:depmun");
        if (depMunRaw) {
            const depMun = JSON.parse(depMunRaw);
            let depKey = Object.keys(depMun).find(d => depInput.includes(normalizarTextoGlobal(d)));
            if (depKey) {
                const municipios = depMun[depKey];
                const munPendiente = state.municipio_pendiente ? normalizarTextoGlobal(state.municipio_pendiente) : "";
                let munReal = null;
                if (munPendiente.length > 3) {
                    munReal = municipios.find(mun => { const nm = normalizarTextoGlobal(mun); return munPendiente.includes(nm) || nm.includes(munPendiente); });
                    if (!munReal) {
                        const partes = munPendiente.split(" ").filter(p => p.length > 3);
                        for (let p of partes) { munReal = municipios.find(mun => normalizarTextoGlobal(mun).includes(p)); if (munReal) break; }
                    }
                }
                if (munReal) {
                    const resFinal = await env.COVERAGE_DB.get("coverage:" + normalizarTextoGlobal(munReal), { type: "json" });
                    state.esperando_departamento = false; state.municipio_pendiente = null;
                    if (resFinal && resFinal.respuesta) return resFinal.respuesta;
                }
                const resDep = await env.COVERAGE_DB.get("coverage:" + normalizarTextoGlobal(depKey), { type: "json" });
                state.esperando_departamento = false; state.municipio_pendiente = null;
                if (resDep && resDep.respuesta) return resDep.respuesta;
                return "Perfecto, en " + depKey.toUpperCase() + " realizamos entregas. ¿Le gustaría que coticemos el envío de algún mueble en específico? 😉";
            }
        }
        state.esperando_departamento = false;
    }
  } catch (e) {}
  return null;
}

async function obtenerProductoSeguro(id, env) {
  if (!id) return null;
  let rid = id.toString().trim().toUpperCase();
  if (rid.includes(":")) rid = rid.split(":").pop();
  const rawCombo = await env.PRODUCTS_DB.get("combo:" + rid);
  const meta = await env.PRODUCTS_DB.get("combo_meta:" + rid, { type: "json" });
  if (rawCombo || meta) {
    let items = []; let totalPiezas = 0;
    if (rawCombo) {
      const parts = rawCombo.split(/[\s,]+/).map(s => s.trim()).filter(s => s);
      for (let i = 0; i < parts.length; i += 2) {
        const cId = parts[i]; const qty = parseInt(parts[i + 1]) || 1;
        const pData = await env.PRODUCTS_DB.get("individual:" + cId, { type: "json" });
        if (pData) {
          const tit = (pData.titulo || pData.nombre || "").toUpperCase();
          if (!tit.includes("FLETE") && !cId.toUpperCase().includes("FLETE")) totalPiezas += qty;
          items.push({ p: pData, q: qty });
        }
      }
    }
    const res = {
      id: rid, key: "combo:" + rid, tipo: "combo", conteo_piezas: totalPiezas,
      titulo: meta?.titulo || ("Combo " + rid), precio: meta?.precio || items.reduce((t, item) => t + ((parseFloat(item.p.precio) || 0) * item.q), 0),
      descripcion: meta?.descripcion || "", medidas: meta?.medidas || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.medidas || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      estructura: meta?.estructura || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.estructura || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      colores: meta?.colores || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.colores || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      resistencia_peso: meta?.resistencia_peso || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.resistencia_peso || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      garantia: meta?.garantia || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.garantia || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      imagenes: [meta?.imagen1, meta?.imagen2, ...items.flatMap(i => [i.p.imagen1, i.p.imagen2, i.p.imagen, i.p.url, i.p.link, i.p.link_publico])].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http")),
      ficha_combinada: items.map(item => { const pre = item.q > 1 ? "(" + item.q + " Unidades) " : ""; return "[" + pre + (item.p.titulo || item.p.nombre) + "] - Medidas: " + (item.p.medidas || "N/A") + " - Material: " + (item.p.estructura || "N/A") + " - Colores: " + (item.p.colores || "N/A"); }).join("\n"),
      ...(meta || {}), items: items.map(i => i.p)
    };
    res.imagenes = [...new Set(res.imagenes)]; return res;
  }
  const ind = await env.PRODUCTS_DB.get("individual:" + rid, { type: "json" });
  return ind ? { ...ind, id: rid, key: "individual:" + rid, tipo: "individual", titulo: ind.titulo || ind.nombre, imagenes: [ind.imagen1, ind.imagen2, ind.link_publico, ind.url, ind.link, ind.imagen].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http")) } : null;
}

async function buscarProductoPorNombreEnMensaje(mensaje, env) {
  try {
    const listado = await getProductList(env); const m = normalizarTextoGlobal(mensaje);
    const ignorar = ["cocina", "ropero", "cama", "mueble", "amueblado", "comedor", "sofa", "gavetero", "tocador", "cabecera", "mesita", "librera"];
    if (m.length < 4) return null; let mejorMatch = null; let maxScore = 0;
    for (const p of listado) {
      const nombre = normalizarTextoGlobal(p.nombre || p.titulo || ""); if (nombre.length < 4) continue;
      let score = 0; const palabras = nombre.split(" ");
      for (let pal of palabras) { if (pal.length > 4 && !ignorar.includes(pal) && m.includes(pal)) score += pal.length; }
      if (score > maxScore && score >= 10) { maxScore = score; mejorMatch = p; }
    }
    if (mejorMatch) { const id = mejorMatch.key ? mejorMatch.key.split(":").pop() : null; if (id) return await obtenerProductoSeguro(id, env); }
  } catch (e) {} return null;
}

async function buscarProductoPorCodigoEnMensaje(mensaje, env) {
  try {
    const listado = await getProductList(env); const m = mensaje.toUpperCase();
    for (const p of listado) {
      const fullKey = (p.key || "").toUpperCase(); const idFromKey = fullKey.split(':').pop();
      const sku = (p.sku || "").toUpperCase(); const codigo = sku || idFromKey;
      if (codigo && codigo.length > 4 && m.includes(codigo)) return await obtenerProductoSeguro(codigo, env);
    }
  } catch (e) {} return null;
}

function detectarSeleccionNatural(mensaje, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const m = normalizarEntradaAvanzada(mensaje);
  const matchPrecio = m.match(/\b(?:q|qt)?\s?(\d{3,5})\b/i);
  if (matchPrecio) {
      const precioMsg = parseInt(matchPrecio[1]);
      const idxPrecio = lista.findIndex(p => {
          const pProd = parseInt(p.precio?.toString().replace(/[^\d]/g, ""));
          return pProd === precioMsg || (pProd > 0 && Math.abs(pProd - precioMsg) <= 10);
      });
      if (idxPrecio !== -1) return idxPrecio;
  }
  if (/\b(medida|cuanto|precio|limpia|resiste|material|fotos|imagenes|color|garantia|dimension)\b/i.test(m)) return null;
  const mapa = { "primero": 0, "primer": 0, "uno": 0, "la 1": 0, "el 1": 0, "segundo": 1, "dos": 1, "la 2": 1, "el 2": 1, "tercero": 2, "tres": 2, "la 3": 2, "el 3": 2, "cuarto": 3, "cuatro": 3, "la 4": 3, "el 4": 3, "ultimo": lista.length - 1 };
  for (let key in mapa) { if (new RegExp("\\b" + key + "\\b", "i").test(m)) return mapa[key]; }
  const matchNum = /\b([1-4])\b(?!\s*(cuerpo|puerta|plaza|gaveta|cajon|c|k|q|p|mt|cm|unid|pieza))/i.exec(m);
  if (matchNum) { const idx = parseInt(matchNum[1]) - 1; if (idx < lista.length) return idx; }
  const scores = lista.map((item, index) => {
    const textoBase = normalizarTextoGlobal(item.nombre || item.titulo || ""); let score = 0;
    const ignorar = ["cocina", "ropero", "cama", "mueble", "amueblado", "comedor", "sofa", "gavetero", "tocador", "cabecera", "mesita", "librera"];
    const pesos = { "arisona": 60, "frostmont": 60, "wengue": 60, "slah": 60, "estandar": 30 };
    Object.keys(pesos).forEach(p => { if (m.includes(p) && textoBase.includes(p)) score += pesos[p]; });
    m.split(/\s+/).forEach(word => { if (word.length >= 5 && !ignorar.includes(word) && textoBase.includes(word)) score += 15; });
    return { index, score };
  });
  const ganador = scores.sort((a, b) => b.score - a.score)[0]; return (ganador && ganador.score >= 15) ? ganador.index : null;
}

// --- Motor IA ---
async function callVendedorElitePro(message, env, productoActual, pideCompra, coverage, esSoloSaludo, esPrimerMensaje, yaEnvioMenu, esNuevoProducto) {
  let info = "";
  if (productoActual) {
    const p = productoActual; const fullSpecs = "Medidas: " + (p.medidas || "N/A") + "\nMaterial: " + (p.estructura || "N/A") + "\nColores: " + (p.colores || "N/A") + "\nResistencia: " + (p.resistencia_peso || "N/A") + "\nGarantía: " + (p.garantia || "N/A");
    if (esNuevoProducto) { info = "PRODUCTO: " + p.titulo + "\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + (p.tipo === "combo" ? "\nComponentes: " + (p.ficha_combinada || "N/A") : "") + "\n(NOTA: El resto de especificaciones técnicas están ocultas para esta primera respuesta, solo da el resumen)"; }
    else if (p.tipo === "combo") { info = "PRODUCTO: " + p.titulo + " (Combo de " + p.conteo_piezas + " piezas)\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + "\n" + fullSpecs + "\nComponentes del combo:\n" + p.ficha_combinada; }
    else { info = "PRODUCTO: " + p.titulo + "\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + "\n" + fullSpecs; }
  }
  const mostrarMenu = !!productoActual && !esSoloSaludo && (!yaEnvioMenu || esNuevoProducto);
  const reglas = [ "1. BREVEDAD: Máximo 2 oraciones normalmente. Evita saltos de línea excesivos.", "2. LISTAS: Usa viñetas atractivas (ej: ✨ o 📍) para características y componentes.", "3. PRESENTACIÓN: Si esNuevoProducto es TRUE, DEBES resumir la 'Descripción' y mencionar brevemente los 'Componentes' usando una lista atractiva. PROHIBIDO dar Medidas, Material, Colores, Resistencia o Garantía en este primer mensaje a menos que el cliente ya haya preguntado.", "4. COMBOS: Si el cliente pide Medidas, Colores o Materiales de un COMBO, debes revisar la información de cada componente en los DATOS PRODUCTO y dar una respuesta detallada para cada uno.", "5. SOLO LO SOLICITADO: No divagues. Mantén el mensaje compacto.", "6. AYUDA: " + (mostrarMenu ? "Al final añade una frase amable indicando que puedes informar sobre: Medidas, Colores, Materiales, Precios, Envío y Cuotas. DEBES poner un doble salto de línea después de esta frase." : "NO añadas temas de ayuda."), "7. COMPRA: " + (esNuevoProducto ? "Después de la ayuda, añade una invitación para comprar solicitando estos datos en listado vertical:\n- Nombre\n- DPI\n- Dirección\n- Teléfono" : ""), "8. EMOJIS: Máximo uno (fuera de las listas).", "9. CIERRE: NUNCA pidas datos si el cliente tiene dudas. Responde primero la duda.", "10. SALUDO: " + (esPrimerMensaje ? "Saluda cordialmente al inicio." : "NO saludes, ya estamos en una conversación.") ];
  const prompt = "Eres un asesor amable de La Mueblería. REGLAS:\n" + reglas.join("\n") + "\n\nIMPORTANTE: esNuevoProducto es " + esNuevoProducto + ". Si es TRUE, presenta el producto con un resumen atractivo.\n\nDATOS PRODUCTO:\n" + info + "\n\nMensaje del cliente: " + message;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.OPENAI_API_KEY }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: "Asesor de muebles breve y amable." }, { role: "user", content: prompt }], temperature: 0.1 }) });
    const data = await res.json(); let content = data.choices[0].message.content;
    if (!mostrarMenu) content = content.replace(/.*(informar sobre|ayudarte con|detalles sobre).*(Medidas|Colores|Materiales|Precios|Envío|Cuotas).*/gi, "").trim();
    return content;
  } catch (err) { return "Con gusto le ayudo. Permítame un momento para confirmarle la información exacta."; }
}

async function moduloCatalogo(message, state, env) {
  const m = normalizarEntradaAvanzada(message);
  const listado = await getProductList(env);
  const categorias = ["cama", "cocina", "ropero", "sofa", "comedor", "gavetero", "tocador", "cabecera", "mesita", "librera", "mesa", "trinchante", "platera", "mueble", "amueblado"];
  let catFound = categorias.find(c => m.includes(c));
  let cat = catFound || state.ultima_categoria || null;
  let tamano = state.filtro_tamano;
  const mMediano = /\b(mediano|mediana|medianos|medianas|pequeño|pequeña|pequeños|pequeñas|estandar|normal|normales)\b/i.test(m);
  const mGrande = /\b(grande|grandes|enorme|enormes|gigante|gigantes|amplio|amplios|espacioso|espaciosos)\b/i.test(m);
  if (mMediano) tamano = "mediano"; else if (mGrande) tamano = "grande";
  if (tamano) state.filtro_tamano = tamano; if (catFound) state.ultima_categoria = cat;
  if (!cat) return { text: "Bienvenido. ¿En qué puedo ayudarle hoy? Contamos con variedad de:\n\n✨ CAMAS\n✨ COCINAS\n✨ ROPEROS\n✨ SALAS\n✨ COMEDORES\n✨ GAVETEROS\n\n¿Cuál le gustaría conocer? 😉" };
  if (!tamano) { const genero = (cat === "cama" || cat === "cocina" || cat === "sala" || cat === "mesa") ? "a" : "o"; return { text: "¿Busca opciones de " + cat.toUpperCase() + " en tamaño " + (genero === "a" ? "mediana" : "mediano") + " o grande? 😉" }; }

  const ignorar = ["mediano", "grande", "pequeño", "otros", "opciones", "combos", "promociones", "muestreme", "mas", "cama", "cocina", "ropero", "sala", "comedor", "mueble", "amueblado"];
  const specs = m.split(/\s+/).filter(word => word.length >= 4 && !ignorar.includes(word));
  const filteredList = (cat === "muebles") ? listado : listado.filter(p => normalizarTextoGlobal(p.nombre || p.titulo).includes(cat));
  const combos = filteredList.filter(p => { const key = (p.key || "").toLowerCase(); const name = (p.nombre || p.titulo || "").toLowerCase(); return key.includes("combo") || name.includes("combo") || name.includes("amueblado"); });
  let resultados = [];
  if (cat === "cama") {
      if (tamano === "mediano") resultados = combos.filter(p => { const t = normalizarTextoGlobal(p.nombre || p.titulo || ""); return t.includes("matri") || t.includes("queen"); });
      else resultados = combos.filter(p => normalizarTextoGlobal(p.nombre || p.titulo || "").includes("king"));
  } else if (cat === "ropero" || cat === "cocina") {
      if (tamano === "mediano") resultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 3499);
      else resultados = combos.filter(p => (parseFloat(p.precio) || 0) >= 3500);
  } else {
      if (tamano === "mediano") resultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 5000);
      else resultados = combos.filter(p => (parseFloat(p.precio) || 0) > 5000);
  }
  if (specs.length > 0) {
      const refinados = resultados.filter(p => { const t = normalizarTextoGlobal((p.nombre || p.titulo || "") + " " + (p.sku || "") + " " + (p.key || "")); return specs.some(s => t.includes(s)); });
      if (refinados.length > 0) resultados = refinados;
  }
  if (m.includes("otro") || m.includes("variedad") || m.includes("mas")) {
      const offset = (state.catalogo_offset || 0) + 4; state.catalogo_offset = offset >= resultados.length ? 0 : offset; resultados = resultados.slice(state.catalogo_offset);
  } else { state.catalogo_offset = 0; }
  let preMsg = "";
  if (resultados.length === 0 && tamano) { preMsg = "Por el momento no tengo más opciones de " + cat.toUpperCase() + " con esas características, pero aquí le muestro lo que tenemos disponible:\n\n"; resultados = combos; }
  resultados = resultados.slice(0, 4);
  if (resultados.length === 0) return { text: "Lo siento, no encontré opciones de " + cat.toUpperCase() + " disponibles en este momento con esas especificaciones. 😉" };
  state.carrito_json = resultados.map(p => ({ key: p.key, nombre: p.nombre || p.titulo, precio: p.precio }));

  // --- UI MEJORADA CON ESPACIADO ---
  let resp = preMsg || ("Aquí tiene opciones de **" + cat.toUpperCase() + (tamano ? " " + tamano.toUpperCase() : "") + "S** disponibles:\n\n");
  resultados.forEach((p, i) => {
      resp += "📍 **" + (i + 1) + ". " + (p.nombre || p.titulo).toUpperCase() + "**\n";
      resp += "💰 **Precio: Q" + p.precio + "**\n\n";
  });
  resp += "¿Cuál le gustaría conocer a detalle? 😉"; return { text: resp };
}

// --- Flow Principal ---
async function processFullFlow(message, state, env) {
  try {
    const norm = normalizarTextoGlobal(message);
    const pideFotos = /fotos?|imagenes?|verlo|verla|mostrar|enviame|fts/i.test(message);
    const pideCompra = /\b(quiero comprar|lo quiero|la quiero|comprarlo|comprarla|quiero el pedido|hacer el pedido|quiero ordenar|proceder con la compra|donde deposito|metodo de pago|cuenta para depositar|como pago|pagar)\b/i.test(norm);
    const pideInformacion = /(medida|dimension|precio|vale|cuesta|costo|valor|material|color|envio|flete|cuota|pago|informacion|detalle|fotos|verlo|verla|especificacion|garantia|resiste)/i.test(norm);
    const pideCatalogo = /catalogo|modelos|opciones|variedad|otros|ver mas|muestreme|mostrame|muestreme mas|oferta|ofertas|otra|otras|venden|vende|que mas/i.test(norm);
    const tieneCategoria = /cama|ropero|cocina|mueble|amueblado|comedor|mesa|gavetero|tocador|trinchante|platera|marquesa|cabecera|mesita|librera/i.test(norm);
    const esAfirmacionGenerica = /^(ok|vale|esta bien|muy bien|si gracias|de acuerdo|perfecto|entendido|así es|esta ok|está ok|si|sii|por favor|porfavor|claro|envia|mandame)$/i.test(norm.trim());
    const esSoloSaludo = /^(hola|buen|buena|buenas|tarde|dia|dias|noche|noches|buena tarde|buen dia|buenos dias|buenas noches|buenas tardes|\s)+$/i.test(norm.trim());

    // --- NUEVAS DETECCIONES: Solo el... y Tecnicas desconocidas ---
    const pideSoloParte = /\b(solo|solamente|separado|aparte|sin el|sin la)\b/i.test(norm);
    const esConsultaTecnicaRara = /\b(colgante|desarmar|desarma|doblar|dobla|empotra|pared|techo|tornillo|instala|clavo|madera tipo)\b/i.test(norm);

    const currentEstado = state.estado_actual || "nuevo";
    const prevProductoId = state.producto_id; const carrito = state.carrito_json || [];

    // 1. Handover para preguntas técnicas desconocidas
    if (esConsultaTecnicaRara) {
        return { text: "Excelente pregunta. Para brindarle una respuesta técnica exacta sobre la instalación y materiales específicos, le transferiré con un asesor especializado. Un momento por favor... 👨‍💼", images: [], state: state };
    }

    const respCoverage = await obtenerRespuestaCoverage(message, env, state);
    if (respCoverage) { if (respCoverage.includes("[PREGUNTAR_DEP]")) return { text: respCoverage.replace("[PREGUNTAR_DEP]", ""), images: [], state: state }; return { text: respCoverage, images: [], state: state }; }

    // 2. Lógica "Solo el..." dentro de un combo
    if (pideSoloParte && prevProductoId) {
        const prodCombo = await obtenerProductoSeguro(prevProductoId, env);
        if (prodCombo && prodCombo.tipo === "combo") {
            const catsInd = ["ropero", "cocina", "cama", "cabecera", "mesita", "gavetero", "tocador", "marquesa", "trinchante", "platera"];
            const catPedida = catsInd.find(c => norm.includes(c));
            if (catPedida && Array.isArray(prodCombo.items)) {
                const itemMatch = prodCombo.items.find(it => normalizarTextoGlobal(it.titulo || it.nombre).includes(catPedida));
                if (itemMatch) {
                    const fullSpecs = "Medidas: " + (itemMatch.medidas || "N/A") + "\nMaterial: " + (itemMatch.estructura || "N/A") + "\nColores: " + (itemMatch.colores || "N/A");
                    const imgs = [itemMatch.imagen1, itemMatch.imagen2, itemMatch.imagen, itemMatch.url].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http"));
                    return { text: "Con gusto, aquí tiene el detalle de la pieza individual:\n\n**" + itemMatch.titulo.toUpperCase() + "**\n💰 Precio: Q" + itemMatch.precio + "\n" + fullSpecs + "\n\nLe transferiré con un asesor para que pueda ayudarle con la compra por separado. 😉", images: imgs, state: state };
                }
            }
        }
    }

    let targetProduct = null; let esSeleccionReciente = false;
    let selIdx = detectarSeleccionNatural(message, carrito);
    if (selIdx !== null && carrito[selIdx]) { const prodId = carrito[selIdx].key.split(":").pop(); targetProduct = await obtenerProductoSeguro(prodId, env); if (targetProduct) esSeleccionReciente = true; }
    if (currentEstado === "catalogo" && !targetProduct && !pideInformacion && (pideCatalogo || norm.length > 4)) { const resCat = await moduloCatalogo(message, state, env); return { text: resCat.text, images: [], state: state }; }

    if (!targetProduct) {
        if (prevProductoId && (pideInformacion || esAfirmacionGenerica)) targetProduct = await obtenerProductoSeguro(prevProductoId, env);
        if (!targetProduct) targetProduct = await buscarProductoPorCodigoEnMensaje(message, env);
        if (!targetProduct && prevProductoId) targetProduct = await obtenerProductoSeguro(prevProductoId, env);
        if (!targetProduct && !pideCatalogo && !pideInformacion) targetProduct = await buscarProductoPorNombreEnMensaje(message, env);
    }
    if (targetProduct) state.producto_id = targetProduct.id;

    let responseText, responseImgs = [], estadoPropuesto = currentEstado === "nuevo" ? "interaccion" : currentEstado;
    if (targetProduct && !pideCatalogo) {
      estadoPropuesto = pideCompra ? "cierre" : "producto";
      const tituloProd = normalizarTextoGlobal(targetProduct.titulo || ""); const cats = ["cama", "cocina", "ropero", "sofa", "comedor", "gavetero", "tocador", "cabecera", "mesita", "librera", "mesa"];
      let catProd = cats.find(c => tituloProd.includes(c)) || state.ultima_categoria; if (catProd) state.ultima_categoria = catProd;
      if (esSeleccionReciente || pideFotos) { if (targetProduct.tipo === "combo" && Array.isArray(targetProduct.items) && targetProduct.items.length >= 3) responseImgs = [...new Set(targetProduct.items.map(item => item.imagen1 || item.imagen2 || item.imagen || item.url || item.link || item.link_publico).filter(url => typeof url === "string" && url.length > 10 && url.startsWith("http")))]; else responseImgs = targetProduct.imagenes || []; }
      const coverage = await obtenerRespuestaCoverage(message, env, state); const esNuevoProducto = targetProduct.id !== prevProductoId && !pideInformacion;
      responseText = await callVendedorElitePro(message, env, targetProduct, pideCompra, coverage, esSoloSaludo, (currentEstado === "nuevo"), (state.menu_ayuda_enviado === "true"), esNuevoProducto);
      if ((esNuevoProducto || state.menu_ayuda_enviado !== "true") && /Medidas|Colores|Materiales|Precios|Envío|Cuotas/i.test(responseText)) state.menu_ayuda_enviado = "true";
    } else if ((pideCatalogo || tieneCategoria || (esSoloSaludo && !state.ultima_categoria) || /\b(mediano|mediana|grande|pequeño|pequeña|enorme|gigante)\b/i.test(norm)) && !pideInformacion) {
      estadoPropuesto = "catalogo"; const resCat = await moduloCatalogo(message, state, env); responseText = resCat.text;
    } else {
      const coverage = await obtenerRespuestaCoverage(message, env, state); responseText = await callVendedorElitePro(message, env, targetProduct, pideCompra, coverage, esSoloSaludo, (currentEstado === "nuevo"), (state.menu_ayuda_enviado === "true"), false);
    }
    state.estado_actual = estadoPropuesto; const caption = targetProduct ? (targetProduct.titulo || "").toUpperCase() : ""; let finalMsg = responseText;
    if (caption && !responseText.toUpperCase().includes(caption)) finalMsg = "**" + caption + "**\n\n" + responseText;
    return { text: finalMsg, images: responseImgs, state: state };
  } catch (err) { return { text: "Con gusto le ayudo. Permítame un momento para confirmarle la información exacta.", images: [], state: state }; }
}

// --- Interfaz HTML ---
const HTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat La Mueblería IA</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; background-color: #0b0d11; color: #e1e1e1; }
        .chat-container { height: calc(100vh - 160px); }
        .message-user { background-color: #2a2d35; border-radius: 18px 18px 0 18px; align-self: flex-end; }
        .message-bot { background-color: #1e2128; border-radius: 18px 18px 18px 0; align-self: flex-start; }
        .glass { background: rgba(30, 33, 40, 0.8); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,0.1); }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3a3f4b; border-radius: 10px; }
        .typing-indicator span { width: 8px; height: 8px; background-color: #6b7280; display: inline-block; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">
    <header class="p-6 flex items-center justify-between border-b border-gray-800 bg-[#0b0d11]">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white shadow-lg"><i class="fas fa-couch"></i></div>
            <div><h1 class="font-bold text-lg">La Mueblería IA</h1><p class="text-xs text-green-500 flex items-center gap-1"><span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> En línea</p></div>
        </div>
        <button onclick="resetChat()" class="text-gray-400 hover:text-white transition-colors"><i class="fas fa-rotate-right"></i></button>
    </header>
    <main id="chat-box" class="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar chat-container flex flex-col">
        <div class="message-bot p-4 max-w-[85%] md:max-w-[70%] animate-fade-in shadow-md whitespace-pre-wrap">
            Hola 👋 Bienvenido a La Mueblería. ¿En qué puedo ayudarle hoy? Contamos con variedad de:

✨ CAMAS
✨ COCINAS
✨ ROPEROS
✨ SALAS
✨ COMEDORES
✨ GAVETEROS

¿Cuál le gustaría conocer? 😉
        </div>
    </main>
    <footer class="glass p-4 md:p-6 pb-8">
        <div class="max-w-4xl mx-auto relative">
            <input type="text" id="user-input" placeholder="Escribe tu mensaje aquí..." class="w-full bg-[#2a2d35] border border-gray-700 rounded-2xl py-4 px-6 pr-14 focus:outline-none focus:ring-2 focus:ring-green-600 transition-all text-white" onkeypress="if(event.key === 'Enter') handleInput()">
            <button onclick="handleInput()" id="send-btn" class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-green-600 hover:bg-green-500 rounded-xl flex items-center justify-center text-white transition-all"><i class="fas fa-paper-plane"></i></button>
        </div>
    </footer>
    <script>
        let sessionId = sessionStorage.getItem('chat_session_id') || Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('chat_session_id', sessionId);
        let pendingMessages = []; let bufferTimeout = null;
        function getChatState() { return JSON.parse(sessionStorage.getItem('chat_state') || '{}'); }
        function saveChatState(state) { sessionStorage.setItem('chat_state', JSON.stringify(state)); }
        function appendMessage(text, isUser, images = []) {
            const chatBox = document.getElementById('chat-box'); const div = document.createElement('div'); div.className = (isUser ? 'message-user' : 'message-bot') + ' p-4 max-w-[85%] md:max-w-[70%] shadow-md whitespace-pre-wrap'; let content = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>'); div.innerHTML = content;
            if (images && images.length > 0) { const imgGrid = document.createElement('div'); imgGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3'; images.forEach(url => { const img = document.createElement('img'); img.src = url; img.className = 'rounded-lg w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity'; img.onclick = () => window.open(url, '_blank'); imgGrid.appendChild(img); }); div.appendChild(imgGrid); }
            chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight;
        }
        function showTyping() { if (document.getElementById('typing-indicator')) return; const chatBox = document.getElementById('chat-box'); const div = document.createElement('div'); div.id = 'typing-indicator'; div.className = 'message-bot p-4 flex gap-1 items-center'; div.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>'; chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight; }
        function removeTyping() { const el = document.getElementById('typing-indicator'); if (el) el.remove(); }
        function handleInput() { const input = document.getElementById('user-input'); const msg = input.value.trim(); if (!msg) return; input.value = ''; appendMessage(msg, true); pendingMessages.push(msg); showTyping(); if (bufferTimeout) clearTimeout(bufferTimeout); bufferTimeout = setTimeout(() => { sendConsolidatedMessage(); }, 2500); }
        async function sendConsolidatedMessage() {
            const input = document.getElementById('user-input'); const btn = document.getElementById('send-btn'); const fullMessage = pendingMessages.join(' '); pendingMessages = []; bufferTimeout = null; input.disabled = true; btn.disabled = true; btn.classList.add('opacity-50');
            try {
                const response = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: fullMessage, sessionId: sessionId, state: getChatState() }) });
                const data = await response.json(); removeTyping(); if (data.text) { appendMessage(data.text, false, data.images); saveChatState(data.state); }
            } catch (err) { removeTyping(); appendMessage('Con gusto le ayudo. Permítame un momento para confirmarle la información exacta.', false); } finally { input.disabled = false; btn.disabled = false; btn.classList.remove('opacity-50'); input.focus(); }
        }
        function resetChat() { sessionStorage.removeItem('chat_state'); location.reload(); }
    </script>
</body>
</html>
`;

// --- Worker Fetch Handler ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response(HTML, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    if (request.method === "POST" && url.pathname === "/chat") {
      const body = await request.json(); const result = await processFullFlow(body.message, body.state || {}, env);
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not Found", { status: 404 });
  }
};
