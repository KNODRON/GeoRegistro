import { auth, db } from "./js/firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =========================
// REFERENCIAS DOM
// =========================

const detailBadge = document.getElementById("detailBadge");
const detailBody = document.getElementById("detailBody");
const layerButtons = document.querySelectorAll(".layer-btn");
const tableBody = document.querySelector(".table-wrapper tbody");

const kpiTotalEl = document.querySelector(".kpi-total");
const kpiPendientesEl = document.querySelector(".kpi-pendientes");
const kpiResueltasEl = document.querySelector(".kpi-resueltas");
const kpiCriticosEl = document.querySelector(".kpi-criticos");
const topZonasContainer = document.getElementById("topZonasContainer");
const actividadRecienteContainer = document.getElementById("actividadRecienteContainer");
const panelActualizado = document.getElementById("panelActualizado");
const pillUsuario = document.getElementById("pillUsuario");
const pillRol = document.getElementById("pillRol");

const filtroBuscar = document.getElementById("buscar");
const filtroPeriodo = document.getElementById("periodo");
const filtroCategoria = document.getElementById("categoria");
const filtroEstado = document.getElementById("estado");
const filtroSector = document.getElementById("sector");
const filtroInspector = document.getElementById("inspector");
const btnAplicarFiltros = document.getElementById("btnAplicarFiltros");

let map = null;
let multicriterioLayer = null;
let marcadoresLayer = null;
let sectorHighlightLayer = null;
let todasLasIncidencias = [];
let incidenciasFiltradas = [];
let sectoresAnalizados = {};
let initialized = false;
let currentLayerMode = "ambos";

const GRID_SIZE_METERS = 220;

// =========================
// HELPERS
// =========================

function getSectorColor(nivel) {
  switch (String(nivel || "").toLowerCase()) {
    case "critical":
    case "crítico":
    case "critico":
      return "#e53935";
    case "high":
    case "alto":
      return "#fb8c00";
    case "medium":
    case "medio":
      return "#fdd835";
    case "low":
    case "bajo":
      return "#66bb6a";
    default:
      return "#90a4ae";
  }
}

function getBadgeClass(nivel) {
  switch (String(nivel || "").toLowerCase()) {
    case "critical":
    case "crítico":
    case "critico":
      return "critical";
    case "high":
    case "alto":
      return "high";
    case "medium":
    case "medio":
      return "medium";
    case "low":
    case "bajo":
      return "low";
    default:
      return "medium";
  }
}

function getBadgeText(nivel) {
  const n = String(nivel || "").toLowerCase();
  if (["critical", "crítico", "critico"].includes(n)) return "MUY CRÍTICO";
  if (["high", "alto"].includes(n)) return "CRÍTICO";
  if (["medium", "medio"].includes(n)) return "ALTO";
  if (["low", "bajo"].includes(n)) return "BAJO";
  return "SIN DATO";
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function capitalizeEstado(estado) {
  const limpio = String(estado || "").trim().toLowerCase();

  switch (limpio) {
    case "pendiente":
      return "Pendiente";
    case "en_proceso":
    case "en proceso":
    case "en gestión":
    case "en gestion":
      return "En proceso";
    case "resuelto":
      return "Resuelto";
    case "escalado":
      return "Escalado";
    default:
      return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "Sin estado";
  }
}

function getFechaDate(fecha) {
  if (!fecha) return null;

  try {
    if (typeof fecha.toDate === "function") return fecha.toDate();
    const d = new Date(fecha);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatFecha(fecha) {
  const d = getFechaDate(fecha);
  return d ? d.toLocaleString("es-CL") : "Sin fecha";
}

function getPeriodoDias(value) {
  switch (value) {
    case "Últimos 7 días":
      return 7;
    case "Últimos 30 días":
      return 30;
    case "Este mes":
      return 31;
    default:
      return null;
  }
}

function normalizarSector(dir) {
  if (!dir || !String(dir).trim()) return "Sin dirección";
  return String(dir)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ");
}

function sectorVisibleTexto(dir) {
  if (!dir || !String(dir).trim()) return "Sin dirección";
  return String(dir).trim();
}

function obtenerPesoCategoria(cat) {
  const mapa = {
    seguridad: 10,
    infraestructura: 7,
    zoonosis: 6,
    alumbrado: 5,
    basura: 4,
    "áreas verdes": 3,
    "areas verdes": 3
  };
  return mapa[String(cat || "").toLowerCase()] || 2;
}

function tieneCoordenadasValidas(item) {
  return (
    typeof item?.lat === "number" &&
    typeof item?.lng === "number" &&
    !Number.isNaN(item.lat) &&
    !Number.isNaN(item.lng) &&
    item.lat !== 0 &&
    item.lng !== 0
  );
}

function metrosALat(metros) {
  return metros / 111320;
}

function metrosALng(metros, lat) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const divisor = 111320 * (Math.abs(cosLat) < 0.000001 ? 0.000001 : cosLat);
  return metros / divisor;
}

function getGridCellKey(lat, lng, sizeMeters = GRID_SIZE_METERS) {
  const latStep = metrosALat(sizeMeters);
  const lngStep = metrosALng(sizeMeters, lat);
  const row = Math.floor(lat / latStep);
  const col = Math.floor(lng / lngStep);
  return `grid_${row}_${col}`;
}

function getGridCellBounds(lat, lng, sizeMeters = GRID_SIZE_METERS) {
  const latStep = metrosALat(sizeMeters);
  const lngStep = metrosALng(sizeMeters, lat);
  const row = Math.floor(lat / latStep);
  const col = Math.floor(lng / lngStep);

  const south = row * latStep;
  const north = south + latStep;
  const west = col * lngStep;
  const east = west + lngStep;

  return [
    [south, west],
    [north, east]
  ];
}

function getGridCellCenter(bounds) {
  const [[south, west], [north, east]] = bounds;
  return [(south + north) / 2, (west + east) / 2];
}

function getNombreCuadricula(bounds) {
  const centro = getGridCellCenter(bounds);
  return `Cuadrícula ${centro[0].toFixed(4)}, ${centro[1].toFixed(4)}`;
}

function getSectorKeyDesdeIncidencia(inc) {
  if (tieneCoordenadasValidas(inc)) {
    return getGridCellKey(inc.lat, inc.lng);
  }
  return `dir_${normalizarSector(inc.direccion)}`;
}

function getSectorNombreDesdeIncidencia(inc) {
  if (tieneCoordenadasValidas(inc)) {
    return getNombreCuadricula(getGridCellBounds(inc.lat, inc.lng));
  }
  return sectorVisibleTexto(inc.direccion);
}

function getBoundsFromCoords(coords) {
  if (!coords.length) return null;
  return L.latLngBounds(coords);
}

function obtenerSectorMasCritico(sectores) {
  const lista = Object.values(sectores || {});
  if (!lista.length) return null;
  return [...lista].sort((a, b) => b.indice - a.indice)[0];
}

// =========================
// CRITICIDAD REAL POR SECTOR
// =========================

function calcularCriticidadPorSector(incidencias) {
  const sectores = {};
  const ahora = new Date();

  incidencias.forEach((inc) => {
    const key = getSectorKeyDesdeIncidencia(inc);

    if (!sectores[key]) {
      const usaGrid = tieneCoordenadasValidas(inc);
      let bounds = null;
      let nombre = "Sin georreferencia";

      if (usaGrid) {
        bounds = getGridCellBounds(inc.lat, inc.lng);
        nombre = getNombreCuadricula(bounds);
      } else if (inc.direccion && String(inc.direccion).trim()) {
        nombre = sectorVisibleTexto(inc.direccion);
      }

      sectores[key] = {
        key,
        nombre,
        total: 0,
        pendientes: 0,
        recientes: 0,
        pesoCategorias: 0,
        incidencias: [],
        categoriasConteo: {},
        bounds,
        esGrid: usaGrid
      };
    }

    const s = sectores[key];

    s.total++;

    const estado = String(inc.estado || "").toLowerCase();
    if (estado === "pendiente" || estado === "en_proceso" || estado === "en proceso") {
      s.pendientes++;
    }

    const fecha = getFechaDate(inc.fecha);
    if (fecha) {
      const diffDias = (ahora - fecha) / (1000 * 60 * 60 * 24);
      if (diffDias <= 7) {
        s.recientes++;
      }
    }

    const peso = obtenerPesoCategoria(inc.categoria);
    s.pesoCategorias += peso;

    const categoria = inc.categoria || "Sin categoría";
    s.categoriasConteo[categoria] = (s.categoriasConteo[categoria] || 0) + 1;

    s.incidencias.push(inc);
  });

  Object.values(sectores).forEach((s) => {
    let indice = (s.total * 12) + (s.pendientes * 8) + (s.recientes * 10) + s.pesoCategorias;
    indice = Math.min(100, indice);
    s.indice = Math.round(indice);

    if (indice >= 75) s.nivel = "Crítico";
    else if (indice >= 50) s.nivel = "Alto";
    else if (indice >= 25) s.nivel = "Medio";
    else s.nivel = "Bajo";

    const dominante = Object.entries(s.categoriasConteo)
      .sort((a, b) => b[1] - a[1])[0];

    s.categoriaDominante = dominante ? dominante[0] : "Sin categoría";
  });

  return sectores;
}

// =========================
// PANEL DERECHO
// =========================

function renderEmptyDetail() {
  if (!detailBadge || !detailBody) return;

  detailBadge.className = "badge medium";
  detailBadge.textContent = "SIN DATO";

  detailBody.innerHTML = `
    <div class="detail-card">
      <h4>Sin selección</h4>
      <div class="detail-list">
        <div><span>Estado</span><strong>Esperando selección</strong></div>
      </div>
    </div>

    <div class="detail-card">
      <h4>Sugerencia</h4>
      <div class="meta">
        Haz clic en una cuadrícula crítica o en un marcador para ver el detalle.
      </div>
    </div>
  `;
}

function renderIncidenciaDetail(item) {
  if (!detailBadge || !detailBody) return;

  const estado = String(item.estado || "").toLowerCase();
  let badgeClass = "medium";
  let badgeText = "EN PROCESO";

  if (estado === "pendiente") {
    badgeClass = "critical";
    badgeText = "PENDIENTE";
  } else if (estado === "resuelto") {
    badgeClass = "low";
    badgeText = "RESUELTO";
  }

  detailBadge.className = `badge ${badgeClass}`;
  detailBadge.textContent = badgeText;

  detailBody.innerHTML = `
    <div class="detail-card">
      <h4>${escapeHtml(item.categoria || "Sin categoría")}</h4>
      <div class="detail-list">
        <div><span>Dirección / sector</span><strong>${escapeHtml(item.direccion || getSectorNombreDesdeIncidencia(item) || "Sin dirección")}</strong></div>
        <div><span>Estado</span><strong>${escapeHtml(capitalizeEstado(item.estado))}</strong></div>
        <div><span>Inspector / usuario</span><strong>${escapeHtml(item.nombreUsuario || "N/A")}</strong></div>
        <div><span>Fecha</span><strong>${escapeHtml(formatFecha(item.fecha))}</strong></div>
      </div>
    </div>

    <div class="detail-card">
      <h4>Descripción</h4>
      <div class="meta">
        ${escapeHtml(item.descripcion || "Sin descripción")}
      </div>
    </div>

    <div class="detail-card">
      <h4>Ubicación</h4>
      <div class="detail-list">
        <div><span>Latitud</span><strong>${escapeHtml(typeof item.lat === "number" ? item.lat.toFixed(6) : "-")}</strong></div>
        <div><span>Longitud</span><strong>${escapeHtml(typeof item.lng === "number" ? item.lng.toFixed(6) : "-")}</strong></div>
      </div>
    </div>
  `;
}

function renderSectorRealDetail(sector) {
  if (!detailBadge || !detailBody) return;

  detailBadge.className = `badge ${getBadgeClass(sector.nivel)}`;
  detailBadge.textContent = getBadgeText(sector.nivel);

  const categoriasOrdenadas = Object.entries(sector.categoriasConteo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const categoriasHtml = categoriasOrdenadas.length
    ? categoriasOrdenadas.map(([nombre, valor]) => `
        <div>
          <span>${escapeHtml(nombre)}</span>
          <strong>${escapeHtml(String(valor))}</strong>
        </div>
      `).join("")
    : `<div><span>Sin datos</span><strong>-</strong></div>`;

  const ultimaIncidencia = [...sector.incidencias]
    .sort((a, b) => (getFechaDate(b.fecha)?.getTime() || 0) - (getFechaDate(a.fecha)?.getTime() || 0))[0];

  detailBody.innerHTML = `
    <div class="detail-card">
      <h4>${escapeHtml(sector.nombre)}</h4>
      <div class="detail-list">
        <div><span>Índice territorial</span><strong>${escapeHtml(String(sector.indice))}</strong></div>
        <div><span>Incidencias</span><strong>${escapeHtml(String(sector.total))}</strong></div>
        <div><span>Pendientes</span><strong>${escapeHtml(String(sector.pendientes))}</strong></div>
        <div><span>Recientes (7 días)</span><strong>${escapeHtml(String(sector.recientes))}</strong></div>
        <div><span>Categoría dominante</span><strong>${escapeHtml(sector.categoriaDominante)}</strong></div>
        <div><span>Último registro</span><strong>${escapeHtml(ultimaIncidencia ? formatFecha(ultimaIncidencia.fecha) : "Sin fecha")}</strong></div>
      </div>
    </div>

    <div class="detail-card">
      <h4>Categorías dominantes</h4>
      <div class="detail-list">
        ${categoriasHtml}
      </div>
    </div>

    <div class="detail-card">
      <h4>Acciones sugeridas</h4>
      <div class="meta">
        - Focalizar patrullaje o fiscalización en esta zona<br>
        - Revisar reincidencia y pendientes abiertos<br>
        - Priorizar seguimiento de categoría dominante<br>
        - Levantar evidencia complementaria en terreno
      </div>
    </div>
  `;
}

// =========================
// PANEL IZQUIERDO
// =========================

function actualizarKPIs(incidencias, sectoresReal) {
  if (kpiTotalEl) kpiTotalEl.textContent = incidencias.length;

  const pendientes = incidencias.filter((i) => String(i.estado || "").toLowerCase() === "pendiente").length;
  const resueltas = incidencias.filter((i) => String(i.estado || "").toLowerCase() === "resuelto").length;
  const sectoresCriticos = Object.values(sectoresReal).filter((s) => ["Crítico", "Alto"].includes(s.nivel)).length;

  if (kpiPendientesEl) kpiPendientesEl.textContent = pendientes;
  if (kpiResueltasEl) kpiResueltasEl.textContent = resueltas;
  if (kpiCriticosEl) kpiCriticosEl.textContent = sectoresCriticos;

  if (panelActualizado) {
    panelActualizado.textContent = `Actualizado: ${new Date().toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }
}

function actualizarTopZonas(sectoresReal) {
  if (!topZonasContainer) return;

  const top = Object.values(sectoresReal)
    .sort((a, b) => b.indice - a.indice)
    .slice(0, 3);

  if (!top.length) {
    topZonasContainer.innerHTML = `
      <div class="ranking-item">
        <strong>Sin datos</strong>
        <div class="meta">Aún no hay análisis disponible</div>
      </div>
    `;
    return;
  }

  topZonasContainer.innerHTML = top.map((sector) => {
    const badgeClass = getBadgeClass(sector.nivel);
    const badgeText = getBadgeText(sector.nivel);

    return `
      <div class="ranking-item zona-critica-clickable" data-sector-key="${escapeHtml(sector.key)}" style="cursor:pointer;">
        <strong>${escapeHtml(sector.nombre)}</strong>
        <div class="meta">${escapeHtml(String(sector.total))} incidencias registradas</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".zona-critica-clickable").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.sectorKey;
      if (!key || !sectoresAnalizados[key]) return;
      seleccionarSectorReal(key);
    });
  });
}

function actualizarActividadReciente(incidencias) {
  if (!actividadRecienteContainer) return;

  const ordenadas = [...incidencias]
    .sort((a, b) => (getFechaDate(b.fecha)?.getTime() || 0) - (getFechaDate(a.fecha)?.getTime() || 0))
    .slice(0, 3);

  if (!ordenadas.length) {
    actividadRecienteContainer.innerHTML = `
      <div class="activity-item">
        <strong>Sin actividad</strong>
        <div class="meta">Aún no hay registros cargados</div>
      </div>
    `;
    return;
  }

  actividadRecienteContainer.innerHTML = ordenadas.map((item) => `
    <div class="activity-item">
      <strong>${escapeHtml(item.categoria || "Sin categoría")}</strong>
      <div class="meta">
        ${escapeHtml(item.nombreUsuario || "N/A")} ·
        ${escapeHtml(capitalizeEstado(item.estado))} ·
        ${escapeHtml(formatFecha(item.fecha))}
      </div>
    </div>
  `).join("");
}

// =========================
// FILTROS
// =========================

function llenarFiltrosDinamicos(incidencias) {
  if (filtroSector) {
    const sectoresUnicos = [...new Set(
      incidencias.map((i) => getSectorNombreDesdeIncidencia(i))
    )].sort();

    filtroSector.innerHTML =
      `<option value="">Todos</option>` +
      sectoresUnicos.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  }

  if (filtroInspector) {
    const inspectoresUnicos = [...new Set(
      incidencias.map((i) => i.nombreUsuario || "N/A")
    )].sort();

    filtroInspector.innerHTML =
      `<option value="">Todos</option>` +
      inspectoresUnicos.map((i) => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join("");
  }
}

function aplicarFiltros(incidencias) {
  const buscar = (filtroBuscar?.value || "").trim().toLowerCase();
  const categoria = filtroCategoria?.value || "";
  const estado = filtroEstado?.value || "";
  const sector = filtroSector?.value || "";
  const inspector = filtroInspector?.value || "";
  const dias = getPeriodoDias(filtroPeriodo?.value || "");

  return incidencias.filter((item) => {
    const fecha = getFechaDate(item.fecha);

    if (dias && fecha) {
      const limite = new Date();
      limite.setDate(limite.getDate() - dias);
      if (fecha < limite) return false;
    }

    if (categoria && item.categoria !== categoria) return false;
    if (estado && String(item.estado || "").toLowerCase() !== estado.toLowerCase()) return false;

    const sectorItem = getSectorNombreDesdeIncidencia(item);
    if (sector && sectorItem !== sector) return false;

    const inspectorItem = item.nombreUsuario || "N/A";
    if (inspector && inspectorItem !== inspector) return false;

    if (buscar) {
      const texto = [
        item.categoria,
        item.descripcion,
        item.direccion,
        item.nombreUsuario,
        sectorItem
      ].join(" ").toLowerCase();

      if (!texto.includes(buscar)) return false;
    }

    return true;
  });
}

// =========================
// TABLA
// =========================

function getEstadoClass(estado) {
  if (estado === "pendiente") return "estado-pendiente";
  if (estado === "en_proceso") return "estado-en-proceso";
  if (estado === "resuelto") return "estado-resuelto";
  return "";
}

function aplicarColorEstado(select) {
  select.classList.remove("estado-pendiente", "estado-en-proceso", "estado-resuelto");
  select.classList.add(getEstadoClass(select.value));
}

function renderIncidenciasEnTabla(registros) {
  if (!tableBody) return;

  if (!registros.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7">No hay incidencias registradas.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = registros.map((inc) => `
    <tr>
      <td>${escapeHtml(inc.folio)}</td>
      <td>${escapeHtml(inc.tipo)}</td>
      <td>${escapeHtml(inc.sector)}</td>
      <td>${escapeHtml(inc.inspector)}</td>
      <td>
        <select class="estado-select ${getEstadoClass(inc.estadoRaw)}" data-id="${escapeHtml(inc.id)}">
          <option value="pendiente" ${inc.estadoRaw === "pendiente" ? "selected" : ""}>Pendiente</option>
          <option value="en_proceso" ${inc.estadoRaw === "en_proceso" ? "selected" : ""}>En proceso</option>
          <option value="resuelto" ${inc.estadoRaw === "resuelto" ? "selected" : ""}>Resuelto</option>
        </select>
      </td>
      <td>${escapeHtml(inc.fecha)}</td>
      <td>${escapeHtml(inc.indiceSector)}</td>
    </tr>
  `).join("");

  document.querySelectorAll(".estado-select").forEach((select) => {
    aplicarColorEstado(select);

    select.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const nuevoEstado = e.target.value;

      aplicarColorEstado(e.target);

      try {
        await updateDoc(doc(db, "incidencias", id), {
          estado: nuevoEstado
        });

        const item = todasLasIncidencias.find((i) => i.id === id);
        if (item) {
          item.estado = nuevoEstado;
        }

        procesarIncidencias({
          docs: todasLasIncidencias.map((item) => ({
            id: item.id,
            data: () => item
          }))
        });
      } catch (error) {
        console.error("Error actualizando estado:", error);
        alert("No se pudo actualizar el estado.");
      }
    });
  });
}

// =========================
// MAPA
// =========================

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) {
    console.error("No se encontró #map");
    return;
  }

  map = L.map("map", { zoomControl: true }).setView([-33.4498, -70.6597], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  multicriterioLayer = L.layerGroup().addTo(map);
  marcadoresLayer = L.layerGroup();
  sectorHighlightLayer = L.layerGroup().addTo(map);

  setTimeout(() => map.invalidateSize(), 300);
}

function limpiarHighlightSector() {
  if (sectorHighlightLayer) {
    sectorHighlightLayer.clearLayers();
  }
}

function renderMulticriterioReal(sectoresReal) {
  if (!multicriterioLayer || !map) return;

  multicriterioLayer.clearLayers();

  const boundsGlobales = [];

  Object.values(sectoresReal || {}).forEach((sector) => {
    if (!sector.bounds) return;

    const color = getSectorColor(sector.nivel);

    const rect = L.rectangle(sector.bounds, {
      color: "#ffffff",
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.38
    });

    rect.bindPopup(`
      <strong>${escapeHtml(sector.nombre)}</strong><br>
      Índice territorial: ${escapeHtml(String(sector.indice))}<br>
      Incidencias: ${escapeHtml(String(sector.total))}<br>
      Pendientes: ${escapeHtml(String(sector.pendientes))}<br>
      Recientes: ${escapeHtml(String(sector.recientes))}<br>
      Categoría dominante: ${escapeHtml(sector.categoriaDominante)}
    `);

    rect.on("click", () => seleccionarSectorReal(sector.key));
    rect.addTo(multicriterioLayer);

    boundsGlobales.push(sector.bounds[0], sector.bounds[1]);
  });

  if (boundsGlobales.length) {
    map.fitBounds(boundsGlobales, { padding: [30, 30] });
  }
}

function seleccionarSectorReal(key) {
  const sector = sectoresAnalizados[key];
  if (!sector || !map) return;

  renderSectorRealDetail(sector);
  limpiarHighlightSector();

  if (sector.bounds) {
    L.rectangle(sector.bounds, {
      color: getSectorColor(sector.nivel),
      weight: 3,
      fillOpacity: 0
    }).addTo(sectorHighlightLayer);

    map.fitBounds(sector.bounds, { padding: [50, 50] });
  }

  sector.incidencias.forEach((item) => {
    if (!tieneCoordenadasValidas(item)) return;

    L.circleMarker([item.lat, item.lng], {
      radius: 8,
      color: "#111827",
      weight: 2,
      fillColor: "#38bdf8",
      fillOpacity: 0.45
    }).addTo(sectorHighlightLayer);
  });
}

function renderMapMarkers(registros) {
  if (!marcadoresLayer) return;

  marcadoresLayer.clearLayers();

  registros.forEach((item) => {
    if (!tieneCoordenadasValidas(item)) return;

    const estado = String(item.estado || "").toLowerCase();
    let fillColor = "#0b5d52";

    if (estado === "pendiente") fillColor = "#ef4444";
    else if (estado === "en_proceso") fillColor = "#f59e0b";
    else if (estado === "resuelto") fillColor = "#22c55e";

    const marker = L.circleMarker([item.lat, item.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor,
      fillOpacity: 1
    });

    marker.bindPopup(`
      <strong>${escapeHtml(item.categoria || "Sin categoría")}</strong><br>
      ${escapeHtml(item.descripcion || "")}<br>
      Dirección: ${escapeHtml(item.direccion || getSectorNombreDesdeIncidencia(item) || "Sin dirección")}<br>
      Estado: ${escapeHtml(capitalizeEstado(item.estado))}<br>
      Usuario: ${escapeHtml(item.nombreUsuario || "N/A")}<br>
      Fecha: ${escapeHtml(formatFecha(item.fecha))}
    `);

    marker.on("click", () => renderIncidenciaDetail(item));
    marker.addTo(marcadoresLayer);
  });
}

function setLayerMode(mode) {
  currentLayerMode = mode;

  if (!map || !multicriterioLayer || !marcadoresLayer) return;

  layerButtons.forEach((button) => button.classList.remove("active"));

  const activeButton = document.querySelector(`[data-layer="${mode}"]`);
  if (activeButton) activeButton.classList.add("active");

  if (map.hasLayer(multicriterioLayer)) map.removeLayer(multicriterioLayer);
  if (map.hasLayer(marcadoresLayer)) map.removeLayer(marcadoresLayer);

  if (mode === "multicriterio") {
    multicriterioLayer.addTo(map);
  } else if (mode === "marcadores") {
    marcadoresLayer.addTo(map);
  } else if (mode === "ambos") {
    multicriterioLayer.addTo(map);
    marcadoresLayer.addTo(map);
  }
}

function bindLayerButtons() {
  layerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLayerMode(button.dataset.layer);
    });
  });
}

// =========================
// FIRESTORE REALTIME
// =========================

function procesarIncidencias(snapshot) {
  todasLasIncidencias = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  llenarFiltrosDinamicos(todasLasIncidencias);
  incidenciasFiltradas = aplicarFiltros(todasLasIncidencias);
  sectoresAnalizados = calcularCriticidadPorSector(incidenciasFiltradas);

  actualizarKPIs(incidenciasFiltradas, sectoresAnalizados);
  actualizarTopZonas(sectoresAnalizados);
  actualizarActividadReciente(incidenciasFiltradas);
  renderMulticriterioReal(sectoresAnalizados);
  renderMapMarkers(incidenciasFiltradas);

const registrosTabla = incidenciasFiltradas.map((item) => {
  const sectorKey = getSectorKeyDesdeIncidencia(item);
  const infoSector = sectoresAnalizados[sectorKey];

  return {
    id: item.id,
    folio: `#${item.id.slice(0, 6)}`,
    tipo: item.categoria || "Sin categoría",
    sector: infoSector ? infoSector.nombre : getSectorNombreDesdeIncidencia(item),
    inspector: item.nombreUsuario || "N/A",
    estadoRaw: String(item.estado || "").toLowerCase(),
    estado: capitalizeEstado(item.estado),
    fecha: formatFecha(item.fecha),
    indiceSector: infoSector ? infoSector.indice : "-"
  };
});

  renderIncidenciasEnTabla(registrosTabla);
  setLayerMode(currentLayerMode);

  const sectorMasCritico = obtenerSectorMasCritico(sectoresAnalizados);
  if (sectorMasCritico) {
    renderSectorRealDetail(sectorMasCritico);
  } else if (incidenciasFiltradas.length) {
    renderIncidenciaDetail(incidenciasFiltradas[0]);
  } else {
    renderEmptyDetail();
    limpiarHighlightSector();
  }
}

function cargarIncidenciasRealtime() {
  onSnapshot(
    collection(db, "incidencias"),
    (snapshot) => {
      console.log("Incidencias recibidas:", snapshot.size);
      procesarIncidencias(snapshot);
    },
    (error) => {
      console.error("Error leyendo incidencias:", error);
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7">Error leyendo incidencias.</td></tr>`;
      }
      renderEmptyDetail();
    }
  );
}

// =========================
// INICIALIZACIÓN
// =========================

function iniciarPanel() {
  if (initialized) return;
  initialized = true;

  initMap();
  bindLayerButtons();
  renderEmptyDetail();

  btnAplicarFiltros?.addEventListener("click", () => {
    procesarIncidencias({
      docs: todasLasIncidencias.map((item) => ({
        id: item.id,
        data: () => item
      }))
    });
  });

  cargarIncidenciasRealtime();
  setLayerMode("ambos");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  try {
    const ref = doc(db, "usuarios", user.uid);
    const snap = await getDoc(ref);

    const pantallaCarga = document.getElementById("pantallaCarga");
    const app = document.querySelector(".app");

    if (pantallaCarga) pantallaCarga.style.display = "none";
    if (app) app.classList.remove("app-oculta");

    if (!snap.exists()) {
      window.location.href = "./login.html";
      return;
    }

    const profile = snap.data();
    if (pillUsuario) {
      pillUsuario.textContent = `Usuario: ${profile.nombre || user.email || "Sin nombre"}`;
    }

    if (pillRol) {
      pillRol.textContent = `Rol: ${profile.rol || "Sin rol"}`;
    }

    if (!profile.activo) {
      window.location.href = "./login.html";
      return;
    }

    if (profile.rol !== "admin") {
      window.location.href = "./operador.html";
      return;
    }

    iniciarPanel();
  } catch (error) {
    console.error("Error validando acceso al dashboard:", error);
    window.location.href = "./login.html";
  }
});

window.cerrarSesion = async function () {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    alert("No se pudo cerrar la sesión.");
  }
};

window.cambiarClave = async function () {
  try {
    const usuario = auth.currentUser;

    if (!usuario || !usuario.email) {
      alert("No se pudo identificar el correo del usuario autenticado.");
      return;
    }

    await sendPasswordResetEmail(auth, usuario.email);
    alert(`Se envió un correo de restablecimiento a ${usuario.email}`);
  } catch (error) {
    console.error("Error al enviar correo de restablecimiento:", error);
    alert("No se pudo enviar el correo para cambiar la contraseña.");
  }
};
