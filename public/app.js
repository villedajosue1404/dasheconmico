(function () {
  // ── AUTH STATE ──
  var token = localStorage.getItem('cmd_token');
  var currentUser = null;

  function setAuth(t, user) {
    token = t;
    currentUser = user;
    if (t) localStorage.setItem('cmd_token', t); else localStorage.removeItem('cmd_token');
    if (user) {
      document.getElementById('userNameText').textContent = user.name;
      document.getElementById('userNameDisplay').style.display = '';
      document.getElementById('brandSub').textContent = user.name + ' · Núcleo Neural';
    } else {
      document.getElementById('userNameDisplay').style.display = 'none';
      document.getElementById('brandSub').textContent = 'Núcleo Neural · Sistema de Gestión';
    }
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, opts).then(function(r) {
      if (r.status === 401) {
        setAuth(null, null);
        showAuth();
        return r.json().catch(function(){});
      }
      return r.json();
    });
  }

  // ── AUTH UI ──
  var isRegister = false;
  var authOverlay = document.getElementById('authOverlay');
  var appContainer = document.getElementById('appContainer');

  function showAuth() {
    authOverlay.classList.remove('hidden');
    appContainer.style.display = 'none';
  }

  function hideAuth() {
    authOverlay.classList.add('hidden');
    appContainer.style.display = '';
    loadBusinesses();
    loadTransactions();
  }

  document.getElementById('authToggleLink').addEventListener('click', function() {
    isRegister = !isRegister;
    document.getElementById('authTitle').textContent = isRegister ? 'Crear Cuenta' : 'Iniciar Sesión';
    document.getElementById('authSub').textContent = isRegister ? 'Nuevo usuario · Centro de Mando' : 'Centro de Mando · Núcleo Neural';
    document.getElementById('authBtn').textContent = isRegister ? 'Registrarse' : 'Entrar';
    document.getElementById('authName').style.display = isRegister ? '' : 'none';
    document.getElementById('authToggleLink').innerHTML = isRegister
      ? '¿Ya tenés cuenta? <span class="auth-switch">Iniciá sesión</span>'
      : '¿No tenés cuenta? <span class="auth-switch">Registrate</span>';
    document.getElementById('authError').style.display = 'none';
  });

  document.getElementById('authBtn').addEventListener('click', function() {
    var email = document.getElementById('authEmail').value.trim();
    var pass = document.getElementById('authPass').value;
    var name = document.getElementById('authName').value.trim();
    var errEl = document.getElementById('authError');
    errEl.style.display = 'none';

    if (!email || !pass || (isRegister && !name)) {
      errEl.textContent = 'Completá todos los campos.';
      errEl.style.display = '';
      return;
    }

    var url = isRegister ? '/api/auth/register' : '/api/auth/login';
    var body = isRegister ? { name: name, email: email, password: pass } : { email: email, password: pass };

    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          setAuth(data.token, data.user);
          hideAuth();
          document.getElementById('authEmail').value = '';
          document.getElementById('authPass').value = '';
          document.getElementById('authName').value = '';
        } else {
          errEl.textContent = data.error || 'Error desconocido';
          errEl.style.display = '';
        }
      })
      .catch(function(e) {
        errEl.textContent = 'Error de conexión: ' + e.message;
        errEl.style.display = '';
      });
  });

  // Enter on password field submits
  document.getElementById('authPass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('authBtn').click();
  });

  // ── RELOJ ──
  function tick() {
    var n = new Date();
    document.getElementById('clock').textContent =
      String(n.getHours()).padStart(2, '0') + ':' +
      String(n.getMinutes()).padStart(2, '0') + ':' +
      String(n.getSeconds()).padStart(2, '0');
  }
  setInterval(tick, 1000);
  tick();

  // ── ESFERA NEURONAL DE CUBOS ──
  var canvas = document.getElementById('sphereCanvas');
  var ctx    = canvas.getContext('2d');
  var W = 240, H = 240, CX = W / 2, CY = H / 2, R = 85;
  var angleX = 0, angleY = 0;
  var pulse  = 0, targetPulse = 0;

  var cubes = [];
  var CUBE_COUNT = 110;
  for (var i = 0; i < CUBE_COUNT; i++) {
    var y = 1 - (i / (CUBE_COUNT - 1)) * 2;
    var radiusAtY = Math.sqrt(1 - y * y);
    var theta = Math.PI * (1 + Math.sqrt(5)) * i;
    var x = Math.cos(theta) * radiusAtY;
    var z = Math.sin(theta) * radiusAtY;
    cubes.push({
      x: x, y: y, z: z,
      size: 2.5 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5
    });
  }

  function rotate3d(p, ax, ay) {
    var cosY = Math.cos(ay), sinY = Math.sin(ay);
    var x1 = p.x * cosY - p.z * sinY;
    var z1 = p.x * sinY + p.z * cosY;
    var cosX = Math.cos(ax), sinX = Math.sin(ax);
    var y1 = p.y * cosX - z1 * sinX;
    var z2 = p.y * sinX + z1 * cosX;
    return { x: x1, y: y1, z: z2 };
  }

  function drawSphere() {
    ctx.clearRect(0, 0, W, H);
    pulse += (targetPulse - pulse) * 0.08;

    var glowR = R * (1.15 + pulse * 0.15);
    var g = ctx.createRadialGradient(CX, CY, R * 0.3, CX, CY, glowR);
    g.addColorStop(0, 'rgba(92,230,196,' + (0.10 + pulse * 0.12) + ')');
    g.addColorStop(1, 'rgba(92,230,196,0)');
    ctx.beginPath();
    ctx.arc(CX, CY, glowR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = 'rgba(92,230,196,0.08)';
    ctx.lineWidth = 0.5;
    for (var lat = -60; lat <= 60; lat += 30) {
      var ry = Math.cos(lat * Math.PI / 180) * R;
      var rx = Math.sin(lat * Math.PI / 180) * R;
      ctx.beginPath();
      ctx.ellipse(CX, CY + rx, ry, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    var rotSpeed = 0.0035 + pulse * 0.01;
    angleY += rotSpeed;
    angleX += rotSpeed * 0.4;

    var projected = cubes.map(function (c) {
      var r = rotate3d(c, angleX, angleY);
      var scale = R / (R + (1 - r.z) * R * 0.6);
      var px = CX + r.x * R * scale;
      var py = CY + r.y * R * scale;
      var flicker = 0.6 + 0.4 * Math.sin(Date.now() / 600 * c.speed + c.phase);
      return { px: px, py: py, z: r.z, size: c.size * scale, flicker: flicker };
    }).sort(function (a, b) { return a.z - b.z; });

    projected.forEach(function (p) {
      var depth = (p.z + 1) / 2;
      var alpha = (0.15 + depth * 0.75) * p.flicker;
      if (alpha < 0.05) return;
      var sz = p.size * (1 + pulse * 0.4);
      var color = depth > 0.55
        ? 'rgba(92,230,196,' + alpha + ')'
        : 'rgba(126,148,160,' + (alpha * 0.7) + ')';
      ctx.save();
      ctx.translate(p.px, p.py);
      ctx.rotate((p.px + p.py) * 0.01 + Date.now() / 4000);
      ctx.fillStyle = color;
      if (depth > 0.55) {
        ctx.shadowBlur = 6 * (1 + pulse);
        ctx.shadowColor = 'rgba(92,230,196,0.8)';
      }
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    });

    if (pulse > 0.05) {
      var coreG = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 0.4 * pulse);
      coreG.addColorStop(0, 'rgba(92,230,196,' + (0.25 * pulse) + ')');
      coreG.addColorStop(1, 'rgba(92,230,196,0)');
      ctx.beginPath();
      ctx.arc(CX, CY, R * 0.4 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = coreG;
      ctx.fill();
    }

    requestAnimationFrame(drawSphere);
  }
  drawSphere();

  function setSphereActive(active) {
    targetPulse = active ? 1 : 0;
    var statusEl = document.getElementById('sphereStatus');
    statusEl.textContent = active ? 'PROCESANDO' : 'EN ESPERA';
    statusEl.classList.toggle('active', active);
  }

  // ── FORMATO ──
  function fmtQ(n) {
    return 'Q ' + parseFloat(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // ── CARGAR DATOS ──
  async function loadBusinesses() {
    try {
      var data = await apiFetch('/api/businesses');
      document.getElementById('dotApi').classList.add('on');

      if (!data.ok || !data.businesses.length) {
        document.getElementById('bizList').innerHTML = '<div class="empty-msg">No hay negocios registrados todavía.</div>';
        document.getElementById('totalsCard').innerHTML = '';
        return;
      }

      var totalIncome = 0, totalExpense = 0, totalBalance = 0;
      var html = '';

      data.businesses.forEach(function (b) {
        var income  = parseFloat(b.total_income);
        var expense = parseFloat(b.total_expense);
        var balance = parseFloat(b.balance);
        totalIncome  += income;
        totalExpense += expense;
        totalBalance += balance;

        html += '<div class="biz-card" style="--biz-color:' + (b.color || '#5ce6c4') + '">';
        html += '<div class="biz-name">' + escapeHtml(b.name) + '</div>';
        html += '<div class="biz-row"><span class="lbl">Ingresos</span><span class="val pos">' + fmtQ(income) + '</span></div>';
        html += '<div class="biz-row"><span class="lbl">Gastos</span><span class="val neg">' + fmtQ(expense) + '</span></div>';
        html += '<div class="biz-balance"><span class="lbl">Balance</span><span class="val ' + (balance >= 0 ? 'pos' : 'neg') + '">' + fmtQ(balance) + '</span></div>';
        html += '</div>';
      });

      document.getElementById('bizList').innerHTML = html;

      var totalsHtml = '<div class="totals-card">';
      totalsHtml += '<div class="lbl">Balance Total</div>';
      totalsHtml += '<div class="big">' + fmtQ(totalBalance) + '</div>';
      totalsHtml += '<div class="totals-sub">';
      totalsHtml += '<span>Ingresos <b>' + fmtQ(totalIncome) + '</b></span>';
      totalsHtml += '<span>Gastos <b>' + fmtQ(totalExpense) + '</b></span>';
      totalsHtml += '</div></div>';
      document.getElementById('totalsCard').innerHTML = totalsHtml;

    } catch (e) {
      console.error('Error cargando negocios:', e);
      document.getElementById('bizList').innerHTML = '<div class="empty-msg">Error de conexión con la API.</div>';
    }
  }

  async function loadTransactions() {
    try {
      var data = await apiFetch('/api/transactions?limit=15');
      if (!data.ok || !data.transactions.length) {
        document.getElementById('txList').innerHTML = '<div class="empty-msg">Sin movimientos todavía.</div>';
        return;
      }
      var html = '';
      data.transactions.forEach(function (t) {
        var isIncome = t.type === 'income';
        html += '<div class="tx-item">';
        html += '<div class="tx-top">';
        html += '<span>' + escapeHtml(t.business_name || '—') + '</span>';
        html += '<span class="tx-amount ' + (isIncome ? 'income' : 'expense') + '">' + (isIncome ? '+' : '-') + fmtQ(t.amount) + '</span>';
        html += '</div>';
        html += '<div class="tx-desc">' + escapeHtml(t.description || '—') + '</div>';
        html += '<div class="tx-meta">' + t.date + '</div>';
        html += '</div>';
      });
      document.getElementById('txList').innerHTML = html;
    } catch (e) {
      console.error('Error cargando transacciones:', e);
      document.getElementById('txList').innerHTML = '<div class="empty-msg">Error de conexión.</div>';
    }
  }

  // ── CHAT CON IA ──
  var chatHistory = [];
  var chatEl = document.getElementById('chatMessages');

  function addMsg(text, type, label) {
    var div = document.createElement('div');
    div.className = 'msg ' + type;
    if (label) {
      var l = document.createElement('div');
      l.className = 'msg-label';
      l.textContent = label;
      div.appendChild(l);
    }
    var span = document.createElement('span');
    span.textContent = text;
    div.appendChild(span);
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  async function sendMessage() {
    var input = document.getElementById('userInput');
    var text  = input.value.trim();
    if (!text) return;
    input.value = '';

    addMsg(text, 'user', 'Tú');
    setSphereActive(true);
    document.getElementById('dotGroq').classList.add('on');

    var thinkingMsg = addMsg('...', 'ai', 'Asistente');

    try {
      var data = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: chatHistory })
      });
      thinkingMsg.remove();

      var reply = data.ok ? data.reply : 'Error: ' + (data.error || 'sin respuesta');
      addMsg(reply, 'ai', 'Asistente');

      chatHistory.push({ role: 'user', content: text });
      chatHistory.push({ role: 'assistant', content: reply });
      if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

      if (voiceEnabled) speak(reply);

      loadBusinesses();
      loadTransactions();

    } catch (e) {
      thinkingMsg.remove();
      addMsg('No pude conectar con el núcleo de IA.', 'ai', 'Sistema');
    } finally {
      setSphereActive(false);
    }
  }

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('userInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendMessage();
  });

  // ── VOZ ──
  var voiceEnabled = false;
  var voiceToggle  = document.getElementById('voiceToggle');

  voiceToggle.addEventListener('click', function () {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('active', voiceEnabled);
    voiceToggle.textContent = voiceEnabled ? 'ON' : 'VOZ';
    if (!voiceEnabled) window.speechSynthesis.cancel();
  });

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    var voices = window.speechSynthesis.getVoices();
    var esVoice = voices.find(function (v) { return v.lang.startsWith('es'); });
    if (esVoice) utter.voice = esVoice;
    utter.onstart = function () { setSphereActive(true); };
    utter.onend   = function () { setSphereActive(false); };
    window.speechSynthesis.speak(utter);
  }

  // ── MIC ──
  var micBtn = document.getElementById('micBtn');
  var recognition = null;
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = function () {
      micBtn.classList.add('active');
      micBtn.textContent = '...';
    };
    recognition.onend = function () {
      micBtn.classList.remove('active');
      micBtn.textContent = 'MIC';
    };
    recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript;
      document.getElementById('userInput').value = transcript;
      sendMessage();
    };
    recognition.onerror = function (e) {
      console.error('Error de reconocimiento:', e.error);
      micBtn.classList.remove('active');
      micBtn.textContent = 'MIC';
    };

    micBtn.addEventListener('click', function () {
      try { recognition.start(); } catch (e) { /* already started */ }
    });
  } else {
    micBtn.style.opacity = '0.3';
    micBtn.title = 'Reconocimiento de voz no disponible en este navegador';
  }

  // ── INIT ──
  // Verificar si hay token guardado
  if (token) {
    apiFetch('/api/auth/me').then(function(data) {
      if (data.ok) {
        setAuth(token, data.user);
        hideAuth();
      } else {
        setAuth(null, null);
        showAuth();
      }
    }).catch(function() {
      showAuth();
    });
  } else {
    showAuth();
  }

  setInterval(loadBusinesses, 30000);
  setInterval(loadTransactions, 30000);

})();