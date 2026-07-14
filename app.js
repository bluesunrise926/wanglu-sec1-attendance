// ============================================================
// 老王客家莊（五權總店）員工打卡系統
// Firebase Compat 版 v1.0
// 新功能：管理員授權管理、電話號碼/自訂帳號登入
// ============================================================

// Firebase 初始化
var firebaseConfig = {
  apiKey: "AIzaSyBs8DcihEgnTDG4FCRgCVGLzUWElDcXQrE",
  authDomain: "wanglu-sec1.firebaseapp.com",
  projectId: "wanglu-sec1",
  storageBucket: "wanglu-sec1.firebasestorage.app",
  messagingSenderId: "101046743403",
  appId: "1:101046743403:web:6515e5106a0713552b9c2e"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
var db   = firebase.firestore();
var auth = firebase.auth();

// ============================================================
// 全域狀態
// ============================================================
var currentUser     = null;
var currentUserData = null;
var currentPosition = null;
var clockTimer      = null;

var IDLE_TIMEOUT = 3 * 60 * 1000;
var WARN_BEFORE  = 60 * 1000;
var idleTimer      = null;
var warnTimer      = null;
var countdownTimer = null;

var sysSettings = {
  locationName: '老王客家莊五權總店',
  lat: 24.137800,
  lng: 120.657200,
  radius: 50,
  workStart: '09:00',
  workEnd: '18:00',
  shifts: [
    { name: '午班', start: '10:00', end: '15:00' },
    { name: '晚班', start: '17:00', end: '22:00' }
  ]
};

var currentShiftIndex = 0;
var shiftEndTimer        = null;
var autoClockOutTimer    = null;
var overtimeNotifUnsub   = null;
var shiftEndAlerted      = {};
var pendingAutoClockData = null;
var dashCurrentDate      = new Date();
var dashCurrentFilter    = 'all';
var _editEmpId           = null;

// ============================================================
// 頁面載入
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  restoreRememberedEmail();
  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  // 電話號碼直接作為登入帳號，無需額外處理
  var today = fmtDate(new Date());
  var regJoin = document.getElementById('regJoinDate');
  if (regJoin) regJoin.value = today;
});

function restoreRememberedEmail() {
  var saved = localStorage.getItem('wanglu_rememberedEmail');
  if (saved) {
    // 顯示時去除 @wanglu.local 後綴，讓使用者看到的是電話號碼
    var display     = saved.replace(/@wanglu\.local$/, '');
    var emailInput  = document.getElementById('loginEmail');
    var rememberChk = document.getElementById('rememberEmail');
    if (emailInput)  emailInput.value    = display;
    if (rememberChk) rememberChk.checked = true;
  }
}

// 帳號類型切換（保留相容）
function toggleAccountType() {}
window.toggleAccountType = toggleAccountType;

// 電話號碼轉換為 Firebase 可用的 email 格式
function phoneToEmail(phone) {
  var cleaned = phone.replace(/\D/g, '');
  return cleaned + '@wanglu.local';
}

// ============================================================
// 畫面切換
// ============================================================
function showLoginScreen() { showScreen('loginScreen'); }
function showRegisterScreen() {
  ['regName','regPhone','regEmail','regPwd','regPwd2','regDept','regIdNumber'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var regPhoneAcc = document.getElementById('regPhoneAccount');
  if (regPhoneAcc) regPhoneAcc.value = '';
  document.getElementById('regJoinDate').value = fmtDate(new Date());
  document.getElementById('regError').style.display = 'none';
  document.getElementById('regProgress').style.display = 'none';
  showScreen('registerScreen');
}
window.showLoginScreen    = showLoginScreen;
window.showRegisterScreen = showRegisterScreen;

// ============================================================
// 自動登出（3 分鐘無操作）
// ============================================================
var IDLE_EVENTS = ['mousemove','mousedown','keydown','touchstart','scroll','click'];
function startIdleWatch() {
  IDLE_EVENTS.forEach(function(e) { document.addEventListener(e, resetIdleTimer, { passive: true }); });
  resetIdleTimer();
}
function stopIdleWatch() {
  IDLE_EVENTS.forEach(function(e) { document.removeEventListener(e, resetIdleTimer); });
  clearTimeout(idleTimer); clearTimeout(warnTimer); clearInterval(countdownTimer);
  hideAutoLogoutBar();
}
function resetIdleTimer() {
  clearTimeout(idleTimer); clearTimeout(warnTimer); clearInterval(countdownTimer);
  hideAutoLogoutBar();
  warnTimer = setTimeout(function() { showAutoLogoutBar(); }, IDLE_TIMEOUT - WARN_BEFORE);
  idleTimer = setTimeout(function() {
    stopIdleWatch();
    showToast('因閒置超過 3 分鐘，已自動登出', 'error');
    handleLogout();
  }, IDLE_TIMEOUT);
}
function showAutoLogoutBar() {
  var bar = document.getElementById('autoLogoutBar');
  if (!bar) return;
  var sec = 60;
  document.getElementById('autoLogoutCountdown').textContent = sec;
  bar.classList.add('show');
  countdownTimer = setInterval(function() {
    sec--;
    var el = document.getElementById('autoLogoutCountdown');
    if (el) el.textContent = sec;
    if (sec <= 0) clearInterval(countdownTimer);
  }, 1000);
}
function hideAutoLogoutBar() {
  var bar = document.getElementById('autoLogoutBar');
  if (bar) bar.classList.remove('show');
  clearInterval(countdownTimer);
}
window.resetIdleTimer = resetIdleTimer;

// ============================================================
// 登入
// ============================================================
function handleLogin() {
  var raw      = document.getElementById('loginEmail').value.trim();
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  var btn      = document.getElementById('loginBtn');

  if (!raw || !password) { showError(errEl, '請輸入帳號與密碼'); return; }

  // 判斷是電話號碼還是 email
  var email = raw;
  if (/^0\d{8,9}$/.test(raw.replace(/\D/g, ''))) {
    email = phoneToEmail(raw);
  }

  var rememberChk = document.getElementById('rememberEmail');
  if (rememberChk && rememberChk.checked) {
    // 儲存原始輸入內容（電話號碼），不儲存轉換後的 email
    localStorage.setItem('wanglu_rememberedEmail', raw);
  } else {
    localStorage.removeItem('wanglu_rememberedEmail');
  }

  btn.textContent = '登入中...';
  btn.disabled    = true;
  errEl.style.display = 'none';
  showScreen('loadingScreen');

  auth.signInWithEmailAndPassword(email, password)
    .then(function(cred) {
      currentUser = cred.user;
      return loadUserData(cred.user.uid);
    })
    .then(function() { return loadSettings(); })
    .then(function() {
      btn.textContent = '登入';
      btn.disabled    = false;
      if (currentUserData && currentUserData.role === 'admin') {
        showScreen('adminScreen');
        initAdmin();
      } else {
        showScreen('employeeScreen');
        initEmployee();
      }
      startIdleWatch();
    })
    .catch(function(e) {
      btn.textContent = '登入';
      btn.disabled    = false;
      showScreen('loginScreen');
      var msg = (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found')
        ? '帳號或密碼錯誤，請重新輸入'
        : e.code === 'auth/too-many-requests' ? '登入失敗次數過多，請稍後再試'
        : e.code === 'auth/invalid-email' ? '帳號格式不正確'
        : '登入失敗，請確認網路連線（' + e.code + '）';
      showError(errEl, msg);
    });
}
window.handleLogin = handleLogin;

// ============================================================
// 員工自助註冊（支援電話號碼或 Email）
// ============================================================
function handleRegister() {
  var name     = document.getElementById('regName').value.trim();
  var phone    = document.getElementById('regPhone').value.trim();
  var pwd      = document.getElementById('regPwd').value;
  var pwd2     = document.getElementById('regPwd2').value;
  var dept     = document.getElementById('regDept').value.trim();
  var joinDate = document.getElementById('regJoinDate').value;
  var idNumber = document.getElementById('regIdNumber') ? document.getElementById('regIdNumber').value.trim() : '';
  var errEl    = document.getElementById('regError');
  var btn      = document.getElementById('regBtn');

  // 帳號一律使用電話號碼
  var isPhone = true;
  var email   = '';
  if (!phone) { showError(errEl, '請填寫電話號碼'); return; }
  email = phoneToEmail(phone);

  if (!name)          { showError(errEl, '請填寫姓名'); return; }
  if (!phone)         { showError(errEl, '請填寫電話號碼'); return; }
  if (!pwd)           { showError(errEl, '請設定密碼'); return; }
  if (pwd.length < 6) { showError(errEl, '密碼至少需要 6 個字元'); return; }
  if (pwd !== pwd2)   { showError(errEl, '兩次密碼輸入不一致'); return; }
  if (!joinDate)      { showError(errEl, '請填寫到職日期'); return; }

  errEl.style.display = 'none';
  btn.textContent = '註冊中...';
  btn.disabled    = true;

  var progressEl  = document.getElementById('regProgress');
  var progressBar = document.getElementById('regProgressBar');
  var progressTxt = document.getElementById('regProgressText');
  progressEl.style.display = 'block';
  progressBar.style.width = '20%';
  progressTxt.textContent = '建立帳號中...';

  var newUid = null;
  auth.createUserWithEmailAndPassword(email, pwd)
    .then(function(cred) {
      newUid = cred.user.uid;
      progressBar.style.width = '60%';
      progressTxt.textContent = '儲存資料...';
      return db.collection('users').doc(newUid).set({
        name:      name,
        email:     email,
        phone:     phone,
        dept:      dept,
        joinDate:  joinDate,
        leaveDate: '',
        idNumber:  idNumber,
        role:      'employee',
        active:    true,
        accountType: 'phone',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function() {
      progressBar.style.width = '85%';
      progressTxt.textContent = '載入系統...';
      currentUser = auth.currentUser;
      return loadUserData(newUid);
    })
    .then(function() { return loadSettings(); })
    .then(function() {
      progressBar.style.width = '100%';
      btn.textContent = '完成註冊並登入';
      btn.disabled    = false;
      progressEl.style.display = 'none';
      showToast('註冊成功！歡迎 ' + name, 'success');
      showScreen('employeeScreen');
      initEmployee();
      startIdleWatch();
    })
    .catch(function(e) {
      btn.textContent = '完成註冊並登入';
      btn.disabled    = false;
      progressEl.style.display = 'none';
      var msg;
      if (e.code === 'auth/email-already-in-use') {
        msg = '此電話號碼已有帳號，請直接登入。';
      } else if (e.code === 'auth/invalid-email') {
        msg = '帳號格式不正確';
      } else if (e.code === 'auth/weak-password') {
        msg = '密碼強度不足，請使用更複雜的密碼';
      } else {
        msg = '註冊失敗：' + (e.message || e.code);
      }
      showError(errEl, msg);
    });
}
window.handleRegister = handleRegister;

// ============================================================
// 登出
// ============================================================
function handleLogout() {
  stopIdleWatch();
  if (clockTimer)         clearInterval(clockTimer);
  if (shiftEndTimer)      clearInterval(shiftEndTimer);
  if (autoClockOutTimer)  clearTimeout(autoClockOutTimer);
  if (overtimeNotifUnsub) { overtimeNotifUnsub(); overtimeNotifUnsub = null; }
  shiftEndAlerted      = {};
  pendingAutoClockData = null;
  currentUser     = null;
  currentUserData = null;
  auth.signOut().then(function() {
    showScreen('loginScreen');
    restoreRememberedEmail();
  }).catch(function() {
    showScreen('loginScreen');
    restoreRememberedEmail();
  });
}
window.handleLogout = handleLogout;

// ============================================================
// 載入用戶資料 / 系統設定
// ============================================================
function loadUserData(uid) {
  return db.collection('users').doc(uid).get().then(function(snap) {
    currentUserData = snap.exists
      ? Object.assign({ uid: uid }, snap.data())
      : { uid: uid, name: '用戶', role: 'employee', dept: '' };
  }).catch(function() {
    currentUserData = { uid: uid, name: '用戶', role: 'employee', dept: '' };
  });
}

function loadSettings() {
  return db.collection('settings').doc('main').get().then(function(snap) {
    if (snap.exists) sysSettings = Object.assign({}, sysSettings, snap.data());
  }).catch(function() {});
}

// ============================================================
// 員工打卡畫面
// ============================================================
function initEmployee() {
  document.getElementById('userNameEmp').textContent   = currentUserData.name || '員工';
  document.getElementById('userDeptEmp').textContent   = currentUserData.dept || '';
  document.getElementById('userAvatarEmp').textContent = (currentUserData.name || '員')[0];
  startClock();
  getGPS();
  initShiftSelector();
  loadTodayStatus();
  populateMonthSel('myMonthSel');
  startShiftEndMonitor();
}

function initShiftSelector() {
  var shifts = sysSettings.shifts || [];
  var bar    = document.getElementById('shiftSelectBar');
  var sel    = document.getElementById('empShiftSel');
  if (!sel) return;
  sel.innerHTML = '';
  if (shifts.length <= 1) {
    bar.style.display = 'none';
    currentShiftIndex = 0;
  } else {
    bar.style.display = 'flex';
    shifts.forEach(function(s, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.name + '（' + s.start + ' – ' + s.end + '）';
      sel.appendChild(opt);
    });
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var best = 0, bestDiff = Infinity;
    shifts.forEach(function(s, i) {
      var parts = s.start.split(':');
      var startMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      var diff = Math.abs(nowMin - startMin);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    sel.value = best;
    currentShiftIndex = best;
  }
}

function onShiftChange() {
  var sel = document.getElementById('empShiftSel');
  currentShiftIndex = parseInt(sel.value) || 0;
  loadTodayStatus();
}
window.onShiftChange = onShiftChange;

function showEmpTab(tabName, el) {
  document.querySelectorAll('.emp-tab-content').forEach(function(s) { s.style.display = 'none'; });
  document.querySelectorAll('.emp-tab').forEach(function(t) { t.classList.remove('active'); });
  var tabEl = document.getElementById('empTab-' + tabName);
  if (tabEl) tabEl.style.display = 'block';
  if (el) el.classList.add('active');
  if (tabName === 'myRecords') loadMyRecords();
}
window.showEmpTab = showEmpTab;

function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}
function updateClock() {
  var now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('zh-TW', { hour12: false });
  document.getElementById('currentDate').textContent = now.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  var dd = document.getElementById('dashDate');
  if (dd) dd.textContent = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ============================================================
// GPS 定位
// ============================================================
function getGPS(onSuccess) {
  var gpsText = document.getElementById('gpsText');
  var gpsIcon = document.getElementById('gpsIcon');
  if (!navigator.geolocation) {
    gpsText.textContent = '裝置不支援 GPS 定位';
    gpsText.style.color = '#e63946';
    gpsIcon.textContent = '❌';
    return;
  }
  gpsText.textContent = '正在取得位置...';
  gpsText.style.color = 'rgba(255,255,255,0.8)';
  gpsIcon.textContent = '📍';

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      currentPosition = pos.coords;
      var btnIn = document.getElementById('btnIn');
      if (btnIn && btnIn._gpsBlocked) { btnIn.disabled = false; btnIn._gpsBlocked = false; }
      var dist = calcDist(pos.coords.latitude, pos.coords.longitude, sysSettings.lat, sysSettings.lng);
      if (dist <= sysSettings.radius) {
        gpsText.textContent = '✅ 位置確認：' + sysSettings.locationName + '（' + Math.round(dist) + ' 公尺）';
        gpsText.style.color = '#2ec4b6';
        gpsIcon.textContent = '✅';
      } else {
        gpsText.textContent = '⚠️ 位置不符：距工作地點 ' + Math.round(dist) + ' 公尺（允許 ' + sysSettings.radius + ' 公尺）';
        gpsText.style.color = '#e63946';
        gpsIcon.textContent = '⚠️';
      }
      if (typeof onSuccess === 'function') onSuccess(pos.coords);
    },
    function(err) {
      currentPosition = null;
      var btnIn = document.getElementById('btnIn');
      if (btnIn && !btnIn.disabled) { btnIn._gpsBlocked = true; btnIn.disabled = true; }
      if (err.code === 1) {
        gpsText.innerHTML = '⛔ 定位權限未開啟，<strong style="color:#fff;text-decoration:underline;cursor:pointer;" onclick="requestGPSPermission()">點此重新授權</strong>';
        gpsText.style.color = '#e63946';
        gpsIcon.textContent = '🔒';
        showGPSPermissionBanner();
      } else {
        gpsText.textContent = '❓ 無法取得位置，請確認定位已開啟';
        gpsText.style.color = '#f77f00';
        gpsIcon.textContent = '❓';
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

function requestGPSPermission() {
  navigator.geolocation.getCurrentPosition(
    function(pos) { currentPosition = pos.coords; hideGPSPermissionBanner(); getGPS(); },
    function() {
      var gpsText = document.getElementById('gpsText');
      gpsText.textContent = '⛔ 請至手機設定 → 隱私權 → 定位服務，開啟瀏覽器定位權限';
      gpsText.style.color = '#e63946';
      var btnIn = document.getElementById('btnIn');
      if (btnIn && !btnIn.disabled) { btnIn._gpsBlocked = true; btnIn.disabled = true; }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
window.requestGPSPermission = requestGPSPermission;

function showGPSPermissionBanner() { var b = document.getElementById('gpsBanner'); if (b) b.style.display = 'flex'; }
function hideGPSPermissionBanner() { var b = document.getElementById('gpsBanner'); if (b) b.style.display = 'none'; }

// ============================================================
// 打卡狀態
// ============================================================
function loadTodayStatus() {
  var today = fmtDate(new Date());
  var shifts = sysSettings.shifts || [];
  var curShift = shifts[currentShiftIndex] || { name: '正常班', start: '09:00', end: '18:00' };
  var recId = today + '_' + currentUser.uid + '_' + currentShiftIndex;

  var icon   = document.getElementById('statusIcon');
  var text   = document.getElementById('statusText');
  var sub    = document.getElementById('statusSub');
  var btnIn  = document.getElementById('btnIn');
  var btnOut = document.getElementById('btnOut');
  var summary = document.getElementById('todaySummary');

  db.collection('records').doc(recId).get().then(function(snap) {
    var rec = snap.exists ? snap.data() : null;
    if (!rec) {
      icon.textContent = '📋'; text.textContent = '本班尚未打卡';
      sub.textContent  = curShift.name + '（' + curShift.start + ' – ' + curShift.end + '）';
      if (!btnIn._gpsBlocked) btnIn.disabled = false;
      btnOut.disabled = true;
      summary.style.display = 'none';
    } else if (rec.clockIn && !rec.clockOut) {
      icon.textContent = '✅'; text.textContent = '已上班打卡';
      sub.textContent  = curShift.name + ' 上班：' + rec.clockIn;
      btnIn.disabled = true; btnOut.disabled = false;
      showSummary(rec.clockIn, null);
    } else if (rec.clockIn && rec.clockOut) {
      icon.textContent = '🏠'; text.textContent = '本班已完成打卡';
      sub.textContent  = curShift.name + ' 工時：' + calcHoursStr(rec.clockIn, rec.clockOut);
      btnIn.disabled = true; btnOut.disabled = true;
      showSummary(rec.clockIn, rec.clockOut);
    }
  });
}

function showSummary(clockIn, clockOut) {
  document.getElementById('todaySummary').style.display = 'block';
  document.getElementById('sumIn').textContent    = clockIn  || '--:--';
  document.getElementById('sumOut').textContent   = clockOut || '--:--';
  document.getElementById('sumHours').textContent = clockIn && clockOut ? calcHoursStr(clockIn, clockOut) : '--';
}

function doClock(type) {
  var now     = new Date();
  var today   = fmtDate(now);
  var timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  var recId   = today + '_' + currentUser.uid + '_' + currentShiftIndex;

  if (type !== 'out') {
    if (!currentPosition) {
      showToast('請先允許定位授權才能打卡', 'error');
      showGPSPermissionBanner();
      getGPS(function() { doClock(type); });
      return;
    }
    var dist = calcDist(currentPosition.latitude, currentPosition.longitude, sysSettings.lat, sysSettings.lng);
    if (dist > sysSettings.radius) {
      showToast('您不在打卡範圍內（距離 ' + Math.round(dist) + ' 公尺）', 'error');
      return;
    }
  }

  var shifts   = sysSettings.shifts || [];
  var curShift = shifts[currentShiftIndex] || { name: '正常班', start: '09:00', end: '18:00' };
  var btnIn    = document.getElementById('btnIn');
  var btnOut   = document.getElementById('btnOut');
  btnIn.disabled = true; btnOut.disabled = true;

  db.collection('records').doc(recId).get().then(function(snap) {
    var promise;
    if (type === 'in') {
      if (snap.exists && snap.data().clockIn) { showToast('本班已打過上班卡', 'error'); loadTodayStatus(); return; }
      promise = db.collection('records').doc(recId).set({
        empId:      currentUser.uid,
        empName:    currentUserData.name,
        empDept:    currentUserData.dept || '',
        date:       today,
        clockIn:    timeStr,
        clockOut:   null,
        shiftName:  curShift.name,
        shiftStart: curShift.start,
        shiftEnd:   curShift.end,
        shiftIndex: currentShiftIndex,
        lat:        currentPosition ? currentPosition.latitude  : null,
        lng:        currentPosition ? currentPosition.longitude : null,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      if (!snap.exists || !snap.data().clockIn) { showToast('尚未打上班卡', 'error'); loadTodayStatus(); return; }
      if (snap.data().clockOut) { showToast('本班已打過下班卡', 'error'); loadTodayStatus(); return; }
      promise = db.collection('records').doc(recId).update({ clockOut: timeStr });
    }
    return promise;
  }).then(function() {
    if (type === 'in') {
      showToast('上班打卡成功！' + timeStr, 'success');
    } else {
      showToast('下班打卡成功！' + timeStr, 'success');
      if (shiftEndTimer) clearInterval(shiftEndTimer);
    }
    loadTodayStatus();
  }).catch(function(e) {
    showToast('打卡失敗：' + e.message, 'error');
    loadTodayStatus();
  });
}
window.doClock = doClock;

// ============================================================
// 下班時間監控
// ============================================================
function startShiftEndMonitor() {
  if (shiftEndTimer) clearInterval(shiftEndTimer);
  shiftEndAlerted = {};
  shiftEndTimer = setInterval(checkShiftEnd, 60000);
  checkShiftEnd();
}

function checkShiftEnd() {
  if (!currentUser || !currentUserData) return;
  var shifts = sysSettings.shifts || [];
  var now = new Date();
  var today = fmtDate(now);
  var nowMin = now.getHours() * 60 + now.getMinutes();

  shifts.forEach(function(shift, idx) {
    var parts = shift.end.split(':');
    var endMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var alertKey = today + '_' + idx;
    if (nowMin >= endMin && nowMin <= endMin + 30 && !shiftEndAlerted[alertKey]) {
      var recId = today + '_' + currentUser.uid + '_' + idx;
      db.collection('records').doc(recId).get().then(function(snap) {
        if (snap.exists && snap.data().clockIn && !snap.data().clockOut) {
          shiftEndAlerted[alertKey] = true;
          pendingAutoClockData = { recId: recId, shiftEnd: shift.end, shiftName: shift.name, shiftIdx: idx };
          showOvertimeDialog(shift, idx, recId);
        }
      });
    }
  });
}

function showOvertimeDialog(shift, shiftIdx, recId) {
  var dlg = document.getElementById('overtimeDialog');
  if (!dlg) return;
  document.getElementById('otDialogTitle').textContent = shift.name + ' 下班時間已到';
  document.getElementById('otDialogMsg').textContent = '現在是 ' + shift.end + '，是否要打下班卡？';
  var sec = 15 * 60;
  var cd  = document.getElementById('otCountdown');
  if (cd) cd.textContent = '15:00';
  dlg.style.display = 'flex';
  autoClockOutTimer = setInterval(function() {
    sec--;
    var m = Math.floor(sec / 60), s = sec % 60;
    if (cd) cd.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    if (sec <= 0) {
      clearInterval(autoClockOutTimer);
      dlg.style.display = 'none';
      doAutoClockOut(recId, shift.end, shift.name);
    }
  }, 1000);
}

function doClockOutNow() {
  clearInterval(autoClockOutTimer);
  document.getElementById('overtimeDialog').style.display = 'none';
  doClock('out');
}
function confirmOvertime() {
  clearInterval(autoClockOutTimer);
  document.getElementById('overtimeDialog').style.display = 'none';
  showToast('已確認加班，請記得下班時手動打卡', 'success');
}
function doAutoClockOut(recId, shiftEnd, shiftName) {
  db.collection('records').doc(recId).update({
    clockOut: shiftEnd,
    isAutoClockOut: true
  }).then(function() {
    showToast('已自動記錄 ' + shiftName + ' 下班（' + shiftEnd + '）', 'success');
    loadTodayStatus();
  });
}
window.doClockOutNow   = doClockOutNow;
window.confirmOvertime = confirmOvertime;

// ============================================================
// 我的出勤記錄
// ============================================================
function loadMyRecords() {
  var month = document.getElementById('myMonthSel').value;
  db.collection('records')
    .where('empId', '==', currentUser.uid)
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date')
    .get()
    .then(function(snap) {
      var records = snap.docs.map(function(d) { return d.data(); })
        .sort(function(a,b) {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return (a.shiftIndex||0) - (b.shiftIndex||0);
        });
      var container = document.getElementById('myRecordsList');
      if (records.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="empty-row">本月無出勤記錄</td></tr>';
        return;
      }
      var html = '';
      records.forEach(function(r) {
        var h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        var shift = r.shiftName ? ('<span class="badge badge-blue">' + r.shiftName + '</span>') : '';
        html += '<tr><td>' + r.date + '</td><td>' + shift + '</td><td>' + (r.clockIn||'--') + '</td><td>' + (r.clockOut||'--') + '</td><td>' + h + '</td></tr>';
      });
      container.innerHTML = html;
    });
}
window.loadMyRecords = loadMyRecords;

// ============================================================
// 管理員後台初始化
// ============================================================
function initAdmin() {
  var name = currentUserData.name || '管理員';
  var topbarAdmin = document.getElementById('topbarAdmin');
  if (topbarAdmin) topbarAdmin.textContent = name;
  startClock();
  loadSettings().then(function() {
    loadDashboard();
    loadEmployeeList();
    populateMonthSel('recMonth');
    populateMonthSel('expMonth');
    populateMonthSel('expMonthStats');
    renderShiftRows();
    loadSettingsForm();
  });
}

function loadSettingsForm() {
  document.getElementById('sLocName').value = sysSettings.locationName || '';
  document.getElementById('sLat').value     = sysSettings.lat || '';
  document.getElementById('sLng').value     = sysSettings.lng || '';
  document.getElementById('sRadius').value  = sysSettings.radius || 50;
}

// ============================================================
// 今日概況儀表板
// ============================================================
function loadDashboard() {
  var today = fmtDate(dashCurrentDate);
  var dd = document.getElementById('dashDate');
  if (dd) dd.textContent = dashCurrentDate.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  Promise.all([
    db.collection('users').get(),
    db.collection('records').where('date', '==', today).get()
  ]).then(function(results) {
    var employees = results[0].docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee' && e.active !== false; });
    var records = results[1].docs.map(function(d) { return d.data(); });

    var present = 0, done = 0;
    var rows = [];
    employees.forEach(function(e) {
      var shifts = sysSettings.shifts || [{ name: '正常班', start: '09:00', end: '18:00' }];
      shifts.forEach(function(shift, idx) {
        var r = records.find(function(rec) { return rec.empId === e.id && (rec.shiftIndex === idx || (idx === 0 && rec.shiftIndex === undefined)); });
        var status = 'absent';
        if (r && r.clockIn && r.clockOut) { status = 'done'; done++; }
        else if (r && r.clockIn) { status = 'present'; present++; }
        rows.push({ e: e, r: r, shift: shift, shiftIdx: idx, status: status });
      });
    });

    var total = employees.length;
    var pct   = total > 0 ? Math.round((present + done) / total * 100) : 0;
    document.getElementById('kpiPresent').textContent = present + done;
    document.getElementById('kpiAbsent').textContent  = Math.max(0, total - present - done);
    document.getElementById('kpiTotal').textContent   = total;
    var ringFill = document.getElementById('kpiRingFill');
    var ringText = document.getElementById('kpiRingText');
    if (ringFill) ringFill.setAttribute('stroke-dasharray', pct + ', 100');
    if (ringText) ringText.textContent = pct + '%';

    renderDashTable(rows);
  });
}

function renderDashTable(rows) {
  var html = '';
  rows.forEach(function(row) {
    var e = row.e, r = row.r, shift = row.shift, status = row.status;
    if (dashCurrentFilter !== 'all' && status !== dashCurrentFilter) return;
    var ci = r ? (r.clockIn || '--') : '--';
    var co = r ? (r.clockOut || '--') : '--';
    var hCell = r && r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
    if (r && r.clockIn && !r.clockOut) {
      var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      var parts  = r.clockIn.split(':');
      var inMin  = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      hCell = '<span style="color:#f77f00">' + calcHoursStr(r.clockIn, new Date().toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'})) + ' ▶</span>';
    }
    var dept = e.dept ? ('<span class="badge badge-gray">' + e.dept + '</span>') : '';
    var shiftBadge = '<span class="badge badge-blue">' + shift.name + '</span>';
    var badge = '';
    if (status === 'done')    badge = '<span class="badge badge-done">已下班</span>';
    else if (status === 'present') badge = '<span class="badge badge-green">上班中</span>';
    else badge = '<span class="badge badge-gray">未打卡</span>';

    var shiftIdx2 = r ? (r.shiftIndex !== undefined ? r.shiftIndex : 0) : row.shiftIdx;
    var manualBtn = '<button class="btn btn-sm btn-outline" onclick="openManualClock(\'' + e.id + '\',\'' + e.name.replace(/'/g,"\\'") + '\',' + shiftIdx2 + ')">補登</button>';

    html += '<tr data-status="' + status + '">';
    html += '<td><strong>' + e.name + '</strong></td>';
    html += '<td>' + dept + '</td>';
    html += '<td>' + shiftBadge + '</td>';
    html += '<td>' + ci + '</td>';
    html += '<td>' + co + '</td>';
    html += '<td>' + hCell + '</td>';
    html += '<td>' + badge + '</td>';
    html += '<td>' + manualBtn + '</td>';
    html += '</tr>';
  });
  document.getElementById('dashBody').innerHTML = html || '<tr><td colspan="8" class="empty-row">沒有符合條件的記錄</td></tr>';
}
window.renderDashTable = renderDashTable;

function changeDashDate(delta) {
  if (delta === 0) {
    dashCurrentDate = new Date();
  } else {
    dashCurrentDate = new Date(dashCurrentDate.getTime() + delta * 86400000);
  }
  loadDashboard();
}
window.changeDashDate = changeDashDate;

function filterDash(filter, el) {
  dashCurrentFilter = filter;
  document.querySelectorAll('.filter-tag').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  loadDashboard();
}
window.filterDash = filterDash;

// ============================================================
// 出勤記錄
// ============================================================
function loadRecords() {
  var month     = document.getElementById('recMonth').value;
  var empFilter = document.getElementById('recEmp').value;
  db.collection('records')
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date', 'desc')
    .get()
    .then(function(snap) {
      var records = snap.docs.map(function(d) { return Object.assign({ _docId: d.id }, d.data()); });
      if (empFilter) records = records.filter(function(r) { return r.empId === empFilter; });
      var html = '';
      records.forEach(function(r) {
        var h     = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        var loc   = r.lat ? (r.lat.toFixed(4) + ', ' + r.lng.toFixed(4)) : '無位置';
        var shift = r.shiftName ? ('<span class="badge badge-blue">' + r.shiftName + '</span>') : '<span class="badge badge-gray">未指定</span>';
        var docId = r._docId;
        var safeEmpName = (r.empName||'').replace(/'/g, "\\'");
        var safeEmpId   = r.empId || '';
        var shiftIdx3   = r.shiftIndex !== undefined ? r.shiftIndex : 0;
        var opCell = '<td class="operation-cell">' +
          '<button class="btn btn-sm btn-outline" onclick="openManualClock(\'' + safeEmpId + '\',\'' + safeEmpName + '\',' + shiftIdx3 + ')">補登</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteRecord(\'' + docId + '\',\'' + safeEmpName + '\',\'' + r.date + '\')" style="margin-left:6px;background:#ff4d4f;color:white;border:none;">🗑 刪除</button>' +
          '</td>';
        html += '<tr><td>' + r.date + '</td><td>' + (r.empName||'') + '</td><td>' + (r.empDept||'') + '</td><td>' + shift + '</td><td>' + (r.clockIn||'--') + '</td><td>' + (r.clockOut||'--') + '</td><td>' + h + '</td><td style="font-size:12px;color:#999;">' + loc + '</td><td>' + (r.note||'') + '</td>' + opCell + '</tr>';
      });
      document.getElementById('recBody').innerHTML = html || '<tr><td colspan="10" class="empty-row">本月無出勤記錄</td></tr>';
    });
}
window.loadRecords = loadRecords;

// ============================================================
// 刪除打卡記錄
// ============================================================
function deleteRecord(recId, empName, date) {
  var confirmDelete = confirm(
    '⚠️ 確定要刪除這筆出勤紀錄嗎？\n\n' +
    '員工：' + empName + '\n' +
    '日期：' + date + '\n\n' +
    '刪除後無法復原！'
  );
  if (!confirmDelete) return;
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = '刪除中...'; }
  db.collection('records').doc(recId).delete()
    .then(function() {
      showToast('「' + empName + '」 ' + date + ' 的出勤紀錄已成功刪除', 'success');
      loadRecords();
      loadDashboard();
    })
    .catch(function(error) {
      console.error('刪除失敗:', error);
      if (btn) { btn.disabled = false; btn.innerHTML = '🗑 刪除'; }
      showToast('刪除失敗：' + (error.message || error.code), 'error');
    });
}
window.deleteRecord = deleteRecord;

// ============================================================
// 員工管理
// ============================================================
function loadEmployeeList() {
  db.collection('users').get().then(function(snap) {
    var employees = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee' || e.role === 'admin'; });

    ['recEmp','expEmp'].forEach(function(selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var cur = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      employees.filter(function(e) { return e.active !== false; })
               .forEach(function(e) { sel.add(new Option(e.name, e.id)); });
      sel.value = cur;
    });

    var html = '';
    employees.forEach(function(e) {
      var status = e.active === false ? '<span class="badge badge-gray">停用</span>' : '<span class="badge badge-green">在職</span>';
      if (e.leaveDate && e.leaveDate <= fmtDate(new Date())) status = '<span class="badge badge-gray">已離職</span>';
      var account = e.phone || (e.email ? e.email.replace(/@wanglu\.local$/, '') : '');
      html += '<tr>';
      html += '<td><strong>' + (e.name||'') + '</strong></td>';
      html += '<td style="font-size:12px;color:#888;">' + account + '</td>';
      html += '<td>' + (e.dept||'') + '</td>';
      html += '<td>' + (e.joinDate||'') + '</td>';
      html += '<td>' + (e.leaveDate||'—') + '</td>';
      html += '<td>' + status + '</td>';
      html += '<td>';
      html += '<button class="btn btn-sm btn-outline" onclick="openEditEmpModal(\'' + e.id + '\')">編輯</button> ';
      if (e.active !== false) {
        html += '<button class="btn btn-sm btn-danger" onclick="toggleEmpStatus(\'' + e.id + '\', false)">停用</button>';
      } else {
        html += '<button class="btn btn-sm btn-outline" onclick="toggleEmpStatus(\'' + e.id + '\', true)">啟用</button>';
      }
      html += '</td></tr>';
    });
    var empBody = document.getElementById('empBody');
    if (empBody) empBody.innerHTML = html || '<tr><td colspan="7" class="empty-row">尚無員工資料</td></tr>';
  });
}
window.loadEmployeeList = loadEmployeeList;

function openAddEmpModal() {
  document.getElementById('newEmpName').value  = '';
  document.getElementById('newEmpEmail').value = '';
  document.getElementById('newEmpPwd').value   = '123456';
  document.getElementById('newEmpDept').value  = '';
  document.getElementById('newEmpJoin').value  = fmtDate(new Date());
  document.getElementById('addEmpError').style.display = 'none';
  document.getElementById('addEmpModal').style.display = 'flex';
}
window.openAddEmpModal = openAddEmpModal;

function createEmployee() {
  var name  = document.getElementById('newEmpName').value.trim();
  var rawPhone = document.getElementById('newEmpEmail').value.trim();
  var email = /^0\d{8,9}$/.test(rawPhone.replace(/\D/g,'')) ? phoneToEmail(rawPhone) : rawPhone;
  var pwd   = document.getElementById('newEmpPwd').value;
  var dept  = document.getElementById('newEmpDept').value.trim();
  var join  = document.getElementById('newEmpJoin').value;
  var errEl = document.getElementById('addEmpError');

  if (!name || !rawPhone || !pwd) { showError(errEl, '請填寫必要欄位'); return; }

  var adminEmail = auth.currentUser ? auth.currentUser.email : '';
  var adminPwd   = prompt('請輸入您的管理員密碼以建立員工帳號：');
  if (!adminPwd) return;

  var secondaryApp;
  try {
    secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary_' + Date.now());
  } catch(e) {
    secondaryApp = firebase.app('secondary_' + Date.now());
  }

  secondaryApp.auth().createUserWithEmailAndPassword(email, pwd)
    .then(function(cred) {
      return db.collection('users').doc(cred.user.uid).set({
        name:        name,
        email:       email,
        phone:       rawPhone,
        dept:        dept,
        joinDate:    join,
        leaveDate:   '',
        role:        'employee',
        active:      true,
        accountType: 'phone',
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        return secondaryApp.auth().signOut();
      });
    })
    .then(function() {
      showToast('員工帳號「' + name + '」建立成功', 'success');
      closeModal('addEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) {
      showError(errEl, '建立失敗：' + (e.message || e.code));
    });
}
window.createEmployee = createEmployee;

function openEditEmpModal(empId) {
  _editEmpId = empId;
  db.collection('users').doc(empId).get().then(function(snap) {
    if (!snap.exists) return;
    var d = snap.data();
    document.getElementById('editEmpName').value  = d.name  || '';
    document.getElementById('editEmpDept').value  = d.dept  || '';
    document.getElementById('editEmpJoin').value  = d.joinDate  || '';
    document.getElementById('editEmpLeave').value = d.leaveDate || '';
    document.getElementById('editEmpPhone').value = d.phone || '';
    document.getElementById('editEmpError').style.display = 'none';
    document.getElementById('editEmpModal').style.display = 'flex';
  });
}
window.openEditEmpModal = openEditEmpModal;

function saveEditEmp() {
  if (!_editEmpId) return;
  var name  = document.getElementById('editEmpName').value.trim();
  var dept  = document.getElementById('editEmpDept').value.trim();
  var join  = document.getElementById('editEmpJoin').value;
  var leave = document.getElementById('editEmpLeave').value;
  var phone = document.getElementById('editEmpPhone').value.trim();
  var errEl = document.getElementById('editEmpError');
  if (!name) { showError(errEl, '姓名不能為空'); return; }
  var active = !leave || leave > fmtDate(new Date());
  db.collection('users').doc(_editEmpId).update({ name: name, dept: dept, joinDate: join, leaveDate: leave, phone: phone, active: active })
    .then(function() {
      showToast('員工資料已更新', 'success');
      closeModal('editEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) { showError(errEl, '更新失敗：' + e.message); });
}
window.saveEditEmp = saveEditEmp;

function toggleEmpStatus(empId, active) {
  db.collection('users').doc(empId).update({ active: active })
    .then(function() {
      showToast(active ? '員工帳號已啟用' : '員工帳號已停用', 'success');
      loadEmployeeList();
    });
}
window.toggleEmpStatus = toggleEmpStatus;

// ============================================================
// 🔑 權限管理（授予/撤銷管理員）
// ============================================================
function loadPermissions() {
  db.collection('users').get().then(function(snap) {
    var users = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(u) { return u.active !== false; });

    var html = '';
    users.forEach(function(u) {
      if (u.id === currentUser.uid) return; // 不顯示自己
      var roleBadge = u.role === 'admin'
        ? '<span class="badge badge-green">管理員</span>'
        : '<span class="badge badge-gray">一般員工</span>';
      var account = u.phone || (u.email ? u.email.replace(/@wanglu\.local$/, '') : '');
      var actionBtn = u.role === 'admin'
        ? '<button class="btn btn-sm btn-danger" onclick="setAdminRole(\'' + u.id + '\',\'' + u.name.replace(/'/g,"\\'") + '\', false)">撤銷管理員</button>'
        : '<button class="btn btn-sm btn-primary" onclick="setAdminRole(\'' + u.id + '\',\'' + u.name.replace(/'/g,"\\'") + '\', true)">授予管理員</button>';
      html += '<tr>';
      html += '<td><strong>' + (u.name||'') + '</strong></td>';
      html += '<td style="font-size:12px;color:#888;">' + account + '</td>';
      html += '<td>' + (u.dept||'') + '</td>';
      html += '<td>' + roleBadge + '</td>';
      html += '<td>' + actionBtn + '</td>';
      html += '</tr>';
    });
    var permBody = document.getElementById('permBody');
    if (permBody) permBody.innerHTML = html || '<tr><td colspan="5" class="empty-row">尚無員工資料</td></tr>';
  });
}
window.loadPermissions = loadPermissions;

function setAdminRole(uid, name, isAdmin) {
  var action = isAdmin ? '授予' : '撤銷';
  if (!confirm('確定要' + action + '「' + name + '」的管理員權限嗎？')) return;
  db.collection('users').doc(uid).update({ role: isAdmin ? 'admin' : 'employee' })
    .then(function() {
      showToast('已' + action + '「' + name + '」的管理員權限', 'success');
      loadPermissions();
      loadEmployeeList();
    })
    .catch(function(e) {
      showToast('操作失敗：' + e.message, 'error');
    });
}
window.setAdminRole = setAdminRole;

// ============================================================
// 手動補登
// ============================================================
function openManualClock(empId, empName, shiftIdx) {
  var dateStr = fmtDate(dashCurrentDate);
  document.getElementById('manualEmpInfo').innerHTML =
    '<div class="manual-emp-badge">' + empName[0] + '</div><div><strong>' + empName + '</strong><br><span style="font-size:12px;color:#888;">補登日期：' + dateStr + '</span></div>';
  document.getElementById('manualDate').value = dateStr;
  document.getElementById('manualClockIn').value  = '';
  document.getElementById('manualClockOut').value = '';
  document.getElementById('manualNote').value     = '';
  document.getElementById('manualClockError').style.display = 'none';
  var sel = document.getElementById('manualShift');
  sel.innerHTML = '';
  (sysSettings.shifts || [{ name: '正常班', start: '09:00', end: '18:00' }]).forEach(function(s, i) {
    sel.add(new Option(s.name + '（' + s.start + '–' + s.end + '）', i));
  });
  if (shiftIdx !== undefined) sel.value = shiftIdx;
  window._manualEmpId   = empId;
  window._manualEmpName = empName;
  document.getElementById('manualClockModal').style.display = 'flex';
}
window.openManualClock = openManualClock;

function saveManualClock() {
  var empId    = window._manualEmpId;
  var empName  = window._manualEmpName;
  var date     = document.getElementById('manualDate').value;
  var shiftIdx = parseInt(document.getElementById('manualShift').value) || 0;
  var ci       = document.getElementById('manualClockIn').value;
  var co       = document.getElementById('manualClockOut').value;
  var note     = document.getElementById('manualNote').value.trim();
  var errEl    = document.getElementById('manualClockError');
  if (!date) { showError(errEl, '請選擇日期'); return; }
  if (!ci)   { showError(errEl, '請填寫上班時間'); return; }
  errEl.style.display = 'none';
  var recId = date + '_' + empId + '_' + shiftIdx;
  var shift = (sysSettings.shifts || [])[shiftIdx] || { name: '正常班', start: '09:00', end: '18:00' };
  db.collection('users').doc(empId).get().then(function(snap) {
    var empData = snap.exists ? snap.data() : {};
    var payload = {
      empId: empId, empName: empName, empDept: empData.dept || '',
      date: date, clockIn: ci, clockOut: co || null,
      shiftName: shift.name, shiftStart: shift.start, shiftEnd: shift.end,
      lat: null, lng: null, shiftIndex: shiftIdx,
      isManual: true, note: note || '手動補登',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return db.collection('records').doc(recId).set(payload, { merge: true });
  }).then(function() {
    showToast('補登記錄已儲存', 'success');
    closeModal('manualClockModal');
    loadDashboard();
  }).catch(function(e) { showError(errEl, '儲存失敗：' + e.message); });
}
window.saveManualClock = saveManualClock;

// ============================================================
// 班別設定
// ============================================================
// 生成小時選單
function makeHourSelect(id, val) {
  var selStyle = 'padding:8px 4px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;background:white;color:#333;cursor:pointer;';
  var h = parseInt((val||'09:00').split(':')[0], 10);
  var html = '<select id="' + id + '" style="' + selStyle + '">';
  for (var hh = 0; hh <= 23; hh++) {
    var label = hh + '時';
    html += '<option value="' + (hh < 10 ? '0'+hh : hh) + '"' + (hh === h ? ' selected' : '') + '>' + label + '</option>';
  }
  html += '</select>';
  return html;
}
// 生成分鐘選單
function makeMinSelect(id, val) {
  var selStyle = 'padding:8px 4px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;background:white;color:#333;cursor:pointer;';
  var m = parseInt((val||'09:00').split(':')[1], 10);
  var html = '<select id="' + id + '" style="' + selStyle + '">';
  [0, 15, 30, 45].forEach(function(mm) {
    var label = (mm < 10 ? '0'+mm : mm) + '分';
    html += '<option value="' + (mm < 10 ? '0'+mm : mm) + '"' + (mm === m ? ' selected' : '') + '>' + label + '</option>';
  });
  html += '</select>';
  return html;
}

function renderShiftRows() {
  var container = document.getElementById('shiftsContainer');
  if (!container) return;
  var shifts = sysSettings.shifts || [];
  var html = '';
  shifts.forEach(function(s, i) {
    var startH = (s.start||'09:00').split(':')[0];
    var startM = (s.start||'09:00').split(':')[1];
    var endH   = (s.end||'18:00').split(':')[0];
    var endM   = (s.end||'18:00').split(':')[1];
    html += '<div class="shift-row" style="display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap;padding:10px;background:#f8f9fa;border-radius:10px;">';
    // 班別名稱
    html += '<input type="text" id="sShiftName_' + i + '" value="' + (s.name||'') + '" placeholder="班別名稱"'
          + ' style="flex:1;min-width:70px;max-width:90px;padding:8px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;background:white;color:#333;">';
    // 開始時間：小時 + 分鐘
    html += makeHourSelect('sShiftStartH_' + i, s.start||'09:00');
    html += makeMinSelect('sShiftStartM_' + i, s.start||'09:00');
    html += '<span style="color:#888;font-weight:bold;">–</span>';
    // 結束時間：小時 + 分鐘
    html += makeHourSelect('sShiftEndH_' + i, s.end||'18:00');
    html += makeMinSelect('sShiftEndM_' + i, s.end||'18:00');
    html += '<button class="btn btn-sm btn-danger" onclick="removeShiftRow(' + i + ')" style="flex-shrink:0;">刪除</button>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function addShiftRow() {
  var shifts = sysSettings.shifts || [];
  shifts.push({ name: '新班別', start: '09:00', end: '18:00' });
  sysSettings.shifts = shifts;
  renderShiftRows();
}
function removeShiftRow(index) {
  var shifts = sysSettings.shifts || [];
  if (shifts.length <= 1) { showToast('至少需保留一個班別', 'error'); return; }
  shifts.splice(index, 1);
  sysSettings.shifts = shifts;
  renderShiftRows();
}
function saveShiftSettings() {
  var container = document.getElementById('shiftsContainer');
  var rows = container.querySelectorAll('.shift-row');
  var shifts = [];
  var valid = true;
  rows.forEach(function(row, i) {
    var name   = document.getElementById('sShiftName_' + i).value.trim();
    var startH = document.getElementById('sShiftStartH_' + i).value;
    var startM = document.getElementById('sShiftStartM_' + i).value;
    var endH   = document.getElementById('sShiftEndH_' + i).value;
    var endM   = document.getElementById('sShiftEndM_' + i).value;
    var start  = startH + ':' + startM;
    var end    = endH   + ':' + endM;
    if (!name) { showToast('請填寫班別名稱', 'error'); valid = false; return; }
    shifts.push({ name: name, start: start, end: end });
  });
  if (!valid || shifts.length === 0) return;
  sysSettings.shifts = shifts;
  sysSettings.workStart = shifts[0].start;
  sysSettings.workEnd   = shifts[0].end;
  db.collection('settings').doc('main').set(sysSettings, { merge: true })
    .then(function() { showToast('班別設定已儲存', 'success'); renderShiftRows(); })
    .catch(function() { showToast('儲存失敗，請確認網路連線', 'error'); });
}
window.addShiftRow      = addShiftRow;
window.removeShiftRow   = removeShiftRow;
window.saveShiftSettings = saveShiftSettings;

function saveGPSSettings() {
  var settings = {
    locationName: document.getElementById('sLocName').value,
    lat:    parseFloat(document.getElementById('sLat').value),
    lng:    parseFloat(document.getElementById('sLng').value),
    radius: parseInt(document.getElementById('sRadius').value),
  };
  if (isNaN(settings.lat) || isNaN(settings.lng)) { showToast('請輸入有效的座標', 'error'); return; }
  sysSettings = Object.assign({}, sysSettings, settings);
  db.collection('settings').doc('main').set(sysSettings, { merge: true })
    .then(function() { showToast('GPS 設定已儲存', 'success'); })
    .catch(function() { showToast('儲存失敗', 'error'); });
}
function useMyLocation() {
  if (!navigator.geolocation) { showToast('裝置不支援 GPS', 'error'); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    document.getElementById('sLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('sLng').value = pos.coords.longitude.toFixed(6);
    showToast('已取得目前位置座標', 'success');
  }, function() { showToast('無法取得位置，請確認定位權限', 'error'); });
}
window.saveGPSSettings = saveGPSSettings;
window.saveTimeSettings = saveShiftSettings;
window.useMyLocation   = useMyLocation;

// ============================================================
// 報表匯出
// ============================================================
function exportAttendanceCSV() {
  var month     = document.getElementById('expMonth').value;
  var empFilter = document.getElementById('expEmp').value;
  db.collection('records')
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date')
    .get()
    .then(function(snap) {
      var records = snap.docs.map(function(d) { return d.data(); });
      if (empFilter) records = records.filter(function(r) { return r.empId === empFilter; });
      var csv = '\uFEFF日期,員工姓名,部門,班別,上班時間,下班時間,工作時數（小時）,打卡緯度,打卡經度\n';
      records.forEach(function(r) {
        var h = r.clockIn && r.clockOut ? calcHoursDec(r.clockIn, r.clockOut).toFixed(2) : '';
        csv += r.date + ',' + (r.empName||'') + ',' + (r.empDept||'') + ',' + (r.shiftName||'') + ',' + (r.clockIn||'') + ',' + (r.clockOut||'') + ',' + h + ',' + (r.lat||'') + ',' + (r.lng||'') + '\n';
      });
      dlCSV(csv, '出勤記錄_' + month + '.csv');
      showToast('出勤報表匯出成功', 'success');
    });
}
function exportWorkStatsCSV() {
  var month = document.getElementById('expMonthStats').value;
  Promise.all([
    db.collection('users').get(),
    db.collection('records').where('date', '>=', month+'-01').where('date', '<=', month+'-31').get()
  ]).then(function(results) {
    var employees = results[0].docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee'; });
    var records = results[1].docs.map(function(d) { return d.data(); });
    var workDays = getWorkDays(month);
    var csv = '\uFEFF員工姓名,部門,出勤天數,缺勤天數,總工時（小時）,正常工時,加班工時\n';
    employees.forEach(function(e) {
      var empRecs = records.filter(function(r) { return r.empId === e.id && r.clockIn && r.clockOut; });
      var total   = empRecs.reduce(function(s, r) { return s + calcHoursDec(r.clockIn, r.clockOut); }, 0);
      var normal  = workDays * 8;
      var ot      = Math.max(0, total - normal);
      csv += e.name + ',' + (e.dept||'') + ',' + empRecs.length + ',' + (workDays - empRecs.length) + ',' + total.toFixed(1) + ',' + normal + ',' + ot.toFixed(1) + '\n';
    });
    dlCSV(csv, '工時統計_' + month + '.csv');
    showToast('工時統計報表匯出成功', 'success');
  });
}
function dlCSV(content, filename) {
  var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
window.exportAttendanceCSV = exportAttendanceCSV;
window.exportWorkStatsCSV  = exportWorkStatsCSV;

// ============================================================
// UI 工具
// ============================================================
function switchTab(tabName, el) {
  document.querySelectorAll('.tab-section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-link').forEach(function(n) { n.classList.remove('active'); });
  var tabEl = document.getElementById('tab-' + tabName);
  if (tabEl) tabEl.classList.add('active');
  if (el) el.classList.add('active');
  var topbarTitle = document.getElementById('topbarTitle');
  if (topbarTitle && el) topbarTitle.textContent = el.querySelector('span:last-child') ? el.querySelector('span:last-child').textContent : tabName;
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  if (tabName === 'dashboard')   loadDashboard();
  if (tabName === 'records')     loadRecords();
  if (tabName === 'employees')   loadEmployeeList();
  if (tabName === 'permissions') loadPermissions();
  if (tabName === 'settings') { loadSettingsForm(); renderShiftRows(); }
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeModalOverlay(id, e) { if (e.target.id === id) closeModal(id); }
function showToast(msg, type) {
  type = type || '';
  var c = document.getElementById('toastContainer');
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
}
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}
function populateMonthSel(selId) {
  var sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '';
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    sel.add(new Option(d.getFullYear() + '年' + (d.getMonth() + 1) + '月', val));
  }
}

// ============================================================
// 計算工具
// ============================================================
function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function calcHoursDec(ci, co) {
  var ih = parseInt(ci.split(':')[0]), im = parseInt(ci.split(':')[1]);
  var oh = parseInt(co.split(':')[0]), om = parseInt(co.split(':')[1]);
  return ((oh * 60 + om) - (ih * 60 + im)) / 60;
}
function calcHoursStr(ci, co) {
  var h = calcHoursDec(ci, co);
  return Math.floor(h) + ' 時 ' + Math.round((h % 1) * 60) + ' 分';
}
function calcDist(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function getWorkDays(monthStr) {
  var parts = monthStr.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]);
  var count = 0;
  for (var d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    var day = new Date(y, m - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

window.switchTab          = switchTab;
window.toggleSidebar      = toggleSidebar;
window.closeModal         = closeModal;
window.closeModalOverlay  = closeModalOverlay;
window.loadRecords        = loadRecords;
window.loadEmployeeList   = loadEmployeeList;
window.loadPermissions    = loadPermissions;
