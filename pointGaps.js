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
  let scaleFactor = 1.0;     // cumulative spacing multiplier (position)
  let sizeFactor = 1.0;      // cumulative point-size multiplier (independent of spacing)
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

  function allPoints(data){
    const pts = [];
    (data.groups || []).forEach(g => {
      (g.segments || []).forEach(seg => {
        (seg.points || []).forEach(p => pts.push(p));
      });
    });
    return pts;
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
    scaleFactor = 1.0;
    sizeFactor = 1.0;

    const b = computeBounds(pts);
    center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };

    updateStats();
    updateReadout();
    updateSizeReadout();
    setControlsEnabled(true);
    emptyState.style.display = 'none';
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
    const pct = Math.round(scaleFactor * 100);
    scaleReadout.textContent = pct + '%';
    statScale.textContent = pct + '%';
  }

  function updateSizeReadout(){
    const pct = Math.round(sizeFactor * 100);
    sizeReadout.textContent = pct + '%';
    statSizeScale.textContent = pct + '%';
  }

  // Compute scaled point position: push/pull each point away from the
  // shape's center by scaleFactor, so spacing between points grows/shrinks
  // uniformly while the overall shape (angles) is preserved.
  function scaledXY(p){
    return {
      x: center.x + (p.x - center.x) * scaleFactor,
      y: center.y + (p.y - center.y) * scaleFactor
    };
  }

  function draw(){
    if (!originalData) return;

    // Recompute bounds using scaled coordinates to size/fit the canvas
    const pts = allPoints(originalData).map(scaledXY);
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
    (originalData.groups || []).forEach(g => {
      (g.segments || []).forEach(seg => {
        const color = PALETTE[colorIdx % PALETTE.length];
        colorIdx++;
        const segPts = (seg.points || []).map(p => {
          const s = scaledXY(p);
          return { x: s.x + offX, y: s.y + offY, size: p.size, canConnect: p.canConnect, mergeState: p.mergeState };
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
        // sizeFactor scales this independently from the spacing scaleFactor above
        segPts.forEach(p => {
          const side = Math.max(1, ((p.size || 4) / 2) * sizeFactor);
          ctx.fillStyle = p.canConnect ? '#ffffff' : color;
          ctx.fillRect(p.x - side / 2, p.y - side / 2, side, side);
          if (p.canConnect) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x - side / 2 - 1.5, p.y - side / 2 - 1.5, side + 3, side + 3);
          }
        });
      });
    });
  }

  function adjustScale(deltaPercent){
    scaleFactor = Math.max(0.05, scaleFactor + deltaPercent / 100);
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
    scaleFactor = 1.0;
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

  window.addEventListener('resize', () => { if (originalData) draw(); });
})();
