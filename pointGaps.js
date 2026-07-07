(function(){
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const emptyState = document.getElementById('emptyState');
  const scaleReadout = document.getElementById('scaleReadout');
  const statScale = document.getElementById('statScale');
  const statSizeScale = document.getElementById('statSizeScale');
  const sizeReadout = document.getElementById('sizeReadout');
  const statGroups = document.getElementById('statGroups');
  const statSegs = document.getElementById('statSegs');
  const statPoints = document.getElementById('statPoints');
  const statSelected = document.getElementById('statSelected');
  const statAnchor = document.getElementById('statAnchor');
  const statExcluded = document.getElementById('statExcluded');
  const segList = document.getElementById('segList');
  const toast = document.getElementById('toast');

  const pasteBtn = document.getElementById('pasteBtn');
  const incBtn = document.getElementById('incBtn');
  const decBtn = document.getElementById('decBtn');
  const resetBtn = document.getElementById('resetBtn');
  const sizeIncBtn = document.getElementById('sizeIncBtn');
  const sizeDecBtn = document.getElementById('sizeDecBtn');
  const sizeResetBtn = document.getElementById('sizeResetBtn');

  const PALETTE = ['#5ee6c8', '#ff8a65', '#8ab4ff', '#e6c85e', '#c88ae6', '#6be675'];

  let originalData = null;   // parsed JSON, untouched
  let center = { x: 0, y: 0 };
  let spacingOffsetX = 0;    // cumulative spacing offset in px (X direction)
  let sizeFactor = 1.0;      // cumulative point-size multiplier (independent of spacing)
  let selectedPoint = null;  // current clicked point metadata
  let anchorSegment = null;  // fixed segment used as spacing reference (set by F1)
  let excludedSegments = new Set(); // segments excluded from spacing offset (set by F2)
  let renderPoints = [];     // points in current canvas coordinate space for hit-test
  const PADDING = 40;        // canvas padding around bounding box

  function showToast(msg, isWarn){
    toast.textContent = msg;
    toast.className = 'toast show' + (isWarn ? ' warn' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>{ toast.className = 'toast'; }, 2600);
  }

  function setControlsEnabled(enabled){
    incBtn.disabled = !enabled;
    decBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
    sizeIncBtn.disabled = !enabled;
    sizeDecBtn.disabled = !enabled;
    sizeResetBtn.disabled = !enabled;
  }
  setControlsEnabled(false);

  function updateSelectedReadout(){
    if (!statSelected) return;
    if (!selectedPoint) {
      statSelected.textContent = '없음';
      return;
    }
    statSelected.textContent = selectedPoint.segmentId + ' · #' + (selectedPoint.pointIndex + 1);
  }

  function updateAnchorReadout(){
    if (!statAnchor) return;
    if (!anchorSegment) {
      statAnchor.textContent = '없음';
      return;
    }
    statAnchor.textContent = anchorSegment.segmentId;
  }

  function segmentKey(meta){
    if (!meta) return '';
    return meta.groupIndex + ':' + meta.segmentIndex;
  }

  function isExcludedSegment(meta){
    if (!meta) return false;
    return excludedSegments.has(segmentKey(meta));
  }

  function updateExcludedReadout(){
    if (!statExcluded) return;
    const ids = [];
    excludedSegments.forEach((key) => {
      const parts = key.split(':');
      const groupIndex = Number(parts[0]);
      const segmentIndex = Number(parts[1]);
      const group = (originalData && originalData.groups ? originalData.groups[groupIndex] : null);
      const seg = (group && group.segments ? group.segments[segmentIndex] : null);
      if (seg && seg.id) ids.push(seg.id);
    });

    if (ids.length === 0) {
      statExcluded.textContent = '없음';
      return;
    }
    statExcluded.textContent = ids.join(', ');
  }

  function isSelectedPoint(pointMeta){
    return !!selectedPoint &&
      selectedPoint.groupIndex === pointMeta.groupIndex &&
      selectedPoint.segmentIndex === pointMeta.segmentIndex &&
      selectedPoint.pointIndex === pointMeta.pointIndex;
  }

  function allPoints(data){
    const pts = [];
    (data.groups || []).forEach(g => {
      (g.segments || []).forEach(seg => {
        (seg.points || []).forEach(p => pts.push(p));
      });
    });
    return pts;
  }

  function allPointsWithMeta(data){
    const pts = [];
    (data.groups || []).forEach((g, groupIndex) => {
      (g.segments || []).forEach((seg, segmentIndex) => {
        (seg.points || []).forEach((p, pointIndex) => {
          pts.push({ p, groupIndex, segmentIndex, pointIndex, segmentId: seg.id });
        });
      });
    });
    return pts;
  }

  function getSourcePoint(meta){
    if (!originalData || !meta) return null;
    const group = (originalData.groups || [])[meta.groupIndex];
    if (!group) return null;
    const seg = (group.segments || [])[meta.segmentIndex];
    if (!seg) return null;
    return (seg.points || [])[meta.pointIndex] || null;
  }

  function getSegment(meta){
    if (!originalData || !meta) return null;
    const group = (originalData.groups || [])[meta.groupIndex];
    if (!group) return null;
    return (group.segments || [])[meta.segmentIndex] || null;
  }

  function getSegmentCenterX(meta){
    const seg = getSegment(meta);
    if (!seg || !Array.isArray(seg.points) || seg.points.length === 0) return null;
    let sum = 0;
    seg.points.forEach(pt => { sum += pt.x; });
    return sum / seg.points.length;
  }

  function getAnchorCenterX(){
    if (!anchorSegment) return null;
    return getSegmentCenterX(anchorSegment);
  }

  function computeBounds(pts){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return { minX, minY, maxX, maxY };
  }

  function loadData(data){
    if (!data || !Array.isArray(data.groups)) {
      showToast('올바른 JSON 형식이 아닙니다 (groups 배열 없음)', true);
      return;
    }
    const pts = allPoints(data);
    if (pts.length === 0) {
      showToast('데이터에 포인트가 없습니다', true);
      return;
    }
    originalData = data;
    spacingOffsetX = 0;
    sizeFactor = 1.0;
    selectedPoint = null;
    anchorSegment = null;
    excludedSegments = new Set();

    const b = computeBounds(pts);
    center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };

    updateStats();
    updateReadout();
    updateSizeReadout();
    updateSelectedReadout();
    updateAnchorReadout();
    updateExcludedReadout();
    setControlsEnabled(true);
    emptyState.style.display = 'none';
    canvas.style.cursor = 'crosshair';
    draw();
    showToast('JSON을 불러왔습니다 (' + pts.length + '개 포인트)');
  }

  function updateStats(){
    if (!originalData) return;
    const groups = originalData.groups || [];
    let segCount = 0, pointCount = 0;
    segList.innerHTML = '';
    let colorIdx = 0;
    groups.forEach(g => {
      (g.segments || []).forEach(seg => {
        segCount++;
        pointCount += (seg.points || []).length;
        const color = PALETTE[colorIdx % PALETTE.length];
        colorIdx++;
        const row = document.createElement('div');
        row.className = 'seg-item';
        row.innerHTML = '<span class="swatch" style="background:' + color + '"></span>' +
                         seg.id + ' · ' + (seg.points || []).length + 'pt';
        segList.appendChild(row);
      });
    });
    statGroups.textContent = groups.length;
    statSegs.textContent = segCount;
    statPoints.textContent = pointCount;
  }

  function updateReadout(){
    const px = Math.round(spacingOffsetX);
    const txt = (px >= 0 ? '+' : '') + px + 'px';
    scaleReadout.textContent = txt;
    statScale.textContent = txt;
  }

  function updateSizeReadout(){
    const pct = Math.round(sizeFactor * 100);
    sizeReadout.textContent = pct + '%';
    statSizeScale.textContent = pct + '%';
  }

  // Spacing control always uses X offset translation only (no scaling).
  // If an anchor segment is set (F1), only non-anchor segments move
  // away/toward the anchor segment in X while preserving each segment's size.
  // If no anchor segment is set, move all segments by the same X offset.
  function scaledXY(p, pointMeta){
    if (isExcludedSegment(pointMeta)) {
      return { x: p.x, y: p.y };
    }

    if (anchorSegment && pointMeta) {
      const anchorCenterX = getAnchorCenterX();
      if (anchorCenterX === null) {
        return { x: p.x, y: p.y };
      }

      const isAnchorSegment =
        pointMeta.groupIndex === anchorSegment.groupIndex &&
        pointMeta.segmentIndex === anchorSegment.segmentIndex;

      if (isAnchorSegment) {
        return { x: p.x, y: p.y };
      }

      const segCenterX = getSegmentCenterX(pointMeta);
      if (segCenterX === null) {
        return { x: p.x, y: p.y };
      }

      const offsetX = segCenterX >= anchorCenterX ? spacingOffsetX : -spacingOffsetX;

      return {
        x: p.x + offsetX,
        y: p.y
      };
    }

    return {
      x: p.x + spacingOffsetX,
      y: p.y
    };
  }

  function draw(){
    if (!originalData) return;
    renderPoints = [];

    // Recompute bounds using scaled coordinates to size/fit the canvas
    const pts = allPointsWithMeta(originalData).map(({ p, groupIndex, segmentIndex, pointIndex, segmentId }) =>
      scaledXY(p, { groupIndex, segmentIndex, pointIndex, segmentId })
    );
    const b = computeBounds(pts);
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);

    const cssW = Math.max(300, Math.min(1000, w + PADDING * 2));
    const cssH = Math.max(300, Math.min(1000, h + PADDING * 2));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // offset so bounding box is centered with padding
    const offX = PADDING - b.minX;
    const offY = PADDING - b.minY;

    let colorIdx = 0;
    (originalData.groups || []).forEach((g, groupIndex) => {
      (g.segments || []).forEach((seg, segmentIndex) => {
        const color = PALETTE[colorIdx % PALETTE.length];
        colorIdx++;
        const segPts = (seg.points || []).map((p, pointIndex) => {
          const s = scaledXY(p, { groupIndex, segmentIndex, pointIndex, segmentId: seg.id });
          return {
            x: s.x + offX,
            y: s.y + offY,
            size: p.size,
            canConnect: p.canConnect,
            mergeState: p.mergeState,
            groupIndex,
            segmentIndex,
            pointIndex,
            segmentId: seg.id
          };
        });

        // polyline
        ctx.beginPath();
        segPts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // points: size:4 -> occupies 2x2 px square (side = size/2), centered on point
        // sizeFactor scales this independently from spacing offset translation above
        segPts.forEach(p => {
          const side = Math.max(1, ((p.size || 4) / 2) * sizeFactor);
          p.side = side;
          renderPoints.push(p);
          ctx.fillStyle = p.canConnect ? '#ffffff' : color;
          ctx.fillRect(p.x - side / 2, p.y - side / 2, side, side);
          if (p.canConnect) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x - side / 2 - 1.5, p.y - side / 2 - 1.5, side + 3, side + 3);
          }
          if (isSelectedPoint(p)) {
            ctx.strokeStyle = '#ffd166';
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x - side / 2 - 4, p.y - side / 2 - 4, side + 8, side + 8);
          }
        });
      });
    });
  }

  function getCanvasXY(evt){
    const rect = canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  function findPointAt(x, y){
    let nearest = null;
    let nearestDistSq = Infinity;

    renderPoints.forEach(p => {
      const pickRadius = Math.max(6, p.side / 2 + 4);
      const dx = x - p.x;
      const dy = y - p.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= pickRadius * pickRadius && distSq < nearestDistSq) {
        nearest = p;
        nearestDistSq = distSq;
      }
    });

    return nearest;
  }

  function adjustScale(deltaPercent){
    spacingOffsetX += deltaPercent;
    updateReadout();
    draw();
  }

  function adjustSize(deltaPercent){
    sizeFactor = Math.max(0.05, sizeFactor + deltaPercent / 100);
    updateSizeReadout();
    draw();
  }

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast('클립보드가 비어있습니다', true);
        return;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch(e) {
        showToast('JSON 파싱 실패: 형식을 확인해주세요', true);
        return;
      }
      loadData(data);
    } catch(err) {
      showToast('클립보드 접근이 차단되었습니다. 권한을 허용해주세요.', true);
    }
  });

  incBtn.addEventListener('click', () => adjustScale(10));
  decBtn.addEventListener('click', () => adjustScale(-10));
  resetBtn.addEventListener('click', () => {
    spacingOffsetX = 0;
    updateReadout();
    draw();
  });

  sizeIncBtn.addEventListener('click', () => adjustSize(50));
  sizeDecBtn.addEventListener('click', () => adjustSize(-50));
  sizeResetBtn.addEventListener('click', () => {
    sizeFactor = 1.0;
    updateSizeReadout();
    draw();
  });

  canvas.addEventListener('click', (evt) => {
    if (!originalData) return;

    const pos = getCanvasXY(evt);
    const found = findPointAt(pos.x, pos.y);

    if (!found) {
      selectedPoint = null;
      updateSelectedReadout();
      draw();
      return;
    }

    selectedPoint = {
      groupIndex: found.groupIndex,
      segmentIndex: found.segmentIndex,
      pointIndex: found.pointIndex,
      segmentId: found.segmentId,
      x: found.x,
      y: found.y,
      sourceX: getSourcePoint(found) ? getSourcePoint(found).x : null,
      sourceY: getSourcePoint(found) ? getSourcePoint(found).y : null
    };
    updateSelectedReadout();
    draw();
  });

  window.addEventListener('keydown', (evt) => {
    if (evt.key !== 'F1') return;
    evt.preventDefault();

    if (!originalData) {
      showToast('먼저 JSON 데이터를 불러와주세요', true);
      return;
    }

    if (!selectedPoint) {
      showToast('기준으로 지정할 다각선의 점을 먼저 선택해주세요', true);
      return;
    }

    anchorSegment = {
      groupIndex: selectedPoint.groupIndex,
      segmentIndex: selectedPoint.segmentIndex,
      segmentId: selectedPoint.segmentId
    };

    updateAnchorReadout();
    draw();
    showToast('기준 다각선 지정: ' + anchorSegment.segmentId);
  });

  window.addEventListener('keydown', (evt) => {
    if (evt.key !== 'F2') return;
    evt.preventDefault();

    if (!originalData) {
      showToast('먼저 JSON 데이터를 불러와주세요', true);
      return;
    }

    if (!selectedPoint) {
      showToast('제외할 다각선의 점을 먼저 선택해주세요', true);
      return;
    }

    const key = segmentKey(selectedPoint);
    const segmentId = selectedPoint.segmentId;

    if (excludedSegments.has(key)) {
      excludedSegments.delete(key);
      showToast('오프셋 제외 해제: ' + segmentId);
    } else {
      excludedSegments.add(key);
      showToast('오프셋 제외 지정: ' + segmentId);
    }

    updateExcludedReadout();
    draw();
  });

  window.addEventListener('resize', () => { if (originalData) draw(); });

  // Expose selected-point snapshot for future features (e.g. selected-point-based spacing).
  window.pointGapViewer = {
    getSelectedPoint: function(){
      return selectedPoint ? Object.assign({}, selectedPoint) : null;
    },
    getAnchorSegment: function(){
      return anchorSegment ? Object.assign({}, anchorSegment) : null;
    },
    getExcludedSegments: function(){
      return Array.from(excludedSegments.values());
    }
  };
})();
