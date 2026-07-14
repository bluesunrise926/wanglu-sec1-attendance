// ============================================================
// 老王客家莊（五權總店）員工打卡系統 — Firebase Compat 版
// 新增：員工自助註冊、離職日管理
// 符合台灣勞動基準法第30條出勤記錄規定
// ============================================================

// Firebase compat SDK 已在 index.html body 底部載入
// 使用全域 firebase 物件，不需要 import 語法

// ============================================================
// Firebase 初始化
// ============================================================
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
var db      = firebase.firestore();
var auth    = firebase.auth();

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
  lat: 24.145200,
  lng: 120.661800,
  radius: 50,
  workStart: '10:00',
  workEnd: '22:00',
  shifts: [
    { name: '午班', start: '10:00', end: '15:00' },
    { name: '晚班', start: '17:00', end: '22:00' }
  ]
};

// 目前員工選擇的班別索引
var currentShiftIndex = 0;

// 下班監控計時器
var shiftEndTimer        = null;  // 每分鐘監控下班時間
var autoClockOutTimer    = null;  // 15 分鐘後自動補打卡
var overtimeNotifUnsub   = null;  // 後台通知監聽取消函數
var shiftEndAlerted      = {};    // 已彈出通知的班別 key，避免重複彈出
var pendingAutoClockData = null;  // 待執行的自動補打卡資料

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
  // 設定到職日預設為今天
  var today = fmtDate(new Date());
  var regJoin = document.getElementById('regJoinDate');
  if (regJoin) regJoin.value = today;
});

function restoreRememberedEmail() {
  var saved = localStorage.getItem('wanglu_rememberedEmail');
  if (saved) {
    var emailInput  = document.getElementById('loginEmail');
    var rememberChk = document.getElementById('rememberEmail');
    if (emailInput)  emailInput.value    = saved;
    if (rememberChk) rememberChk.checked = true;
  }
}

// ============================================================
// 畫面切換
// ============================================================
function showLoginScreen() {
  showScreen('loginScreen');
}

function showRegisterScreen() {
  // 清空表單
  ['regName','regEmail','regPwd','regPwd2','regDept','regPhone','regIdNumber'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
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
  IDLE_EVENTS.forEach(function(e) {
    document.addEventListener(e, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

function stopIdleWatch() {
  IDLE_EVENTS.forEach(function(e) {
    document.removeEventListener(e, resetIdleTimer);
  });
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  clearInterval(countdownTimer);
  hideAutoLogoutBar();
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  clearInterval(countdownTimer);
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
// 登入 / 登出
// ============================================================
// 電話號碼轉換為 Firebase 可用的 email 格式
function phoneToEmail(phone) {
  var cleaned = phone.replace(/\D/g, '');
  return cleaned + '@wanglu.local';
}

function handleLogin() {
  var rawPhone = document.getElementById('loginEmail').value.trim();
  var email    = rawPhone.includes('@') ? rawPhone : phoneToEmail(rawPhone);
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  var btn      = document.getElementById('loginBtn');

  if (!rawPhone || !password) { showError(errEl, '請輸入電話號碼與密碼'); return; }

  var rememberChk = document.getElementById('rememberEmail');
  if (rememberChk && rememberChk.checked) {
    localStorage.setItem('wanglu_rememberedEmail', rawPhone);
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
    .then(function() {
      return loadSettings();
    })
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
        : e.code === 'auth/too-many-requests'
        ? '登入失敗次數過多，請稍後再試'
        : e.code === 'auth/invalid-email'
        ? '帳號格式不正確'
        : '登入失敗，請確認網路連線（' + e.code + '）';
      showError(errEl, msg);
    });
}

// ============================================================
// 員工自助註冊
// ============================================================
function handleRegister() {
  var name     = document.getElementById('regName').value.trim();
  var phone    = document.getElementById('regPhone').value.trim();
  var email    = phoneToEmail(phone);  // 電話號碼自動轉換為 email 格式
  var pwd      = document.getElementById('regPwd').value;
  var pwd2     = document.getElementById('regPwd2').value;
  var dept     = document.getElementById('regDept').value.trim();
  var joinDate = document.getElementById('regJoinDate').value;
  var idNumber = document.getElementById('regIdNumber') ? document.getElementById('regIdNumber').value.trim() : '';
  var errEl    = document.getElementById('regError');
  var btn      = document.getElementById('regBtn');

  // 驗證
  if (!name)          { showError(errEl, '請填寫姓名'); return; }
  if (!phone)         { showError(errEl, '請填寫電話號碼'); return; }
  if (phone.replace(/\D/g,'').length < 9) { showError(errEl, '請輸入有效的電話號碼'); return; }
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
        dept:      dept,
        joinDate:  joinDate,
        leaveDate: '',
        phone:     phone,
        idNumber:  idNumber,
        role:      'employee',
        active:    true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function() {
      progressBar.style.width = '85%';
      progressTxt.textContent = '載入系統...';
      currentUser = auth.currentUser;
      return loadUserData(newUid);
    })
    .then(function() {
      return loadSettings();
    })
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
        msg = '此電話號碼已有帳號，請點「返回登入」直接登入。';
      } else if (e.code === 'auth/invalid-email') {
        msg = '電話號碼格式不正確，請重新輸入';
      } else if (e.code === 'auth/weak-password') {
        msg = '密碼強度不足，請使用更複雜的密碼';
      } else {
        msg = '註冊失敗：' + (e.message || e.code);
      }
      showError(errEl, msg);
    });
}

window.handleRegister = handleRegister;

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

window.handleLogin  = handleLogin;
window.handleLogout = handleLogout;

// ============================================================
// 載入用戶資料
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

// ============================================================
// 載入系統設定
// ============================================================
function loadSettings() {
  return db.collection('settings').doc('main').get().then(function(snap) {
    if (snap.exists) sysSettings = Object.assign({}, sysSettings, snap.data());
  }).catch(function() { /* 使用預設值 */ });
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
  // 啟動下班時間監控
  startShiftEndMonitor();
}

// 初始化班別選擇器
function initShiftSelector() {
  var shifts = sysSettings.shifts || [];
  var bar    = document.getElementById('shiftSelectBar');
  var sel    = document.getElementById('empShiftSel');
  if (!sel) return;

  sel.innerHTML = '';
  if (shifts.length <= 1) {
    // 只有一個班別時自動套用，不顯示選擇列
    bar.style.display = 'none';
    currentShiftIndex = 0;
  } else {
    // 多班別：顯示選擇列
    bar.style.display = 'flex';
    shifts.forEach(function(s, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.name + '（' + s.start + ' – ' + s.end + '）';
      sel.appendChild(opt);
    });
    // 依目前時間自動建議班別
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var best = 0;
    var bestDiff = Infinity;
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
  // 切換班別後重新載入該班打卡狀態
  loadTodayStatus();
}

window.onShiftChange = onShiftChange;

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
      // GPS 授權成功，解除上班按鈕的 GPS 封鎖
      var btnIn  = document.getElementById('btnIn');
      if (btnIn  && btnIn._gpsBlocked)  { btnIn.disabled  = false; btnIn._gpsBlocked  = false; }
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
      // 拒絕授權時禁用《上班》按鈕，下班打卡不受 GPS 封鎖（防止員工忘記下班打卡）
      var btnIn  = document.getElementById('btnIn');
      if (btnIn  && !btnIn.disabled)  { btnIn._gpsBlocked  = true; btnIn.disabled  = true; }
      if (err.code === 1) {
        // 使用者拒絕授權
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

// 強制重新請求定位授權
function requestGPSPermission() {
  var gpsText = document.getElementById('gpsText');
  var gpsIcon = document.getElementById('gpsIcon');
  gpsText.textContent = '正在請求定位授權...';
  gpsText.style.color = 'rgba(255,255,255,0.8)';
  gpsIcon.textContent = '📍';
  // 再次呼叫 getCurrentPosition 會觸發系統授權彈窗
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      currentPosition = pos.coords;
      hideGPSPermissionBanner();
      getGPS();
    },
    function() {
      gpsText.textContent = '⛔ 請至手機設定 → 隱私權 → 定位服務，開啟瀏覽器定位權限';
      gpsText.style.color = '#e63946';
      // 再次拒絕時也確保上班按鈕被禁用（下班不封鎖）
      var btnIn  = document.getElementById('btnIn');
      if (btnIn  && !btnIn.disabled)  { btnIn._gpsBlocked  = true; btnIn.disabled  = true; }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
window.requestGPSPermission = requestGPSPermission;

function showGPSPermissionBanner() {
  var banner = document.getElementById('gpsBanner');
  if (banner) banner.style.display = 'flex';
}
function hideGPSPermissionBanner() {
  var banner = document.getElementById('gpsBanner');
  if (banner) banner.style.display = 'none';
}

function loadTodayStatus() {
  var today = fmtDate(new Date());
  var shifts = sysSettings.shifts || [];
  var curShift = shifts[currentShiftIndex] || { name: '正常班', start: '09:00', end: '18:00' };
  // 每個班別有獨立的記錄 ID：日期_員工UID_班別索引
  var recId = today + '_' + currentUser.uid + '_' + currentShiftIndex;

  var icon    = document.getElementById('statusIcon');
  var text    = document.getElementById('statusText');
  var sub     = document.getElementById('statusSub');
  var btnIn   = document.getElementById('btnIn');
  var btnOut  = document.getElementById('btnOut');
  var summary = document.getElementById('todaySummary');

  db.collection('records').doc(recId).get().then(function(snap) {
    var rec = snap.exists ? snap.data() : null;
    if (!rec) {
      icon.textContent = '📋';
      text.textContent = '本班尚未打卡';
      sub.textContent  = curShift.name + '（' + curShift.start + ' – ' + curShift.end + '）';
      // 上班按鈕：如果 GPS 封鎖中則保持禁用
      if (!btnIn._gpsBlocked)  btnIn.disabled  = false;
      // 下班按鈕：尚未上班時一律禁用（不受 GPS 封鎖影響）
      btnOut.disabled = true;
      summary.style.display = 'none';
    } else if (rec.clockIn && !rec.clockOut) {
      icon.textContent = '✅';
      text.textContent = '已上班打卡';
      sub.textContent  = curShift.name + ' 上班：' + rec.clockIn;
      // 已上班時，上班按鈕一律禁用
      btnIn.disabled = true;
      // 下班按鈕：不受 GPS 封鎖影響，直接啟用
      btnOut.disabled = false;
      showSummary(rec.clockIn, null);
    } else if (rec.clockIn && rec.clockOut) {
      icon.textContent = '🏠';
      text.textContent = '本班已完成打卡';
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
  // 每個班別獨立記錄：日期_員工UID_班別索引
  var recId   = today + '_' + currentUser.uid + '_' + currentShiftIndex;

  // 下班打卡不需要 GPS（防止員工忘記打卡）
  if (type !== 'out') {
    // 上班打卡才需要 GPS
    if (!currentPosition) {
      showToast('請先允許定位授權才能打卡', 'error');
      showGPSPermissionBanner();
      getGPS(function() { doClock(type); });
      return;
    }
    var dist = calcDist(currentPosition.latitude, currentPosition.longitude, sysSettings.lat, sysSettings.lng);
    if (dist > sysSettings.radius) {
      showToast('⛔ 位置不符！距工作地點 ' + Math.round(dist) + ' 公尺，需在 ' + sysSettings.radius + ' 公尺範圍內才可打卡', 'error');
      return;
    }
  }

  var btn = type === 'in' ? document.getElementById('btnIn') : document.getElementById('btnOut');
  btn.disabled = true;
  btn.querySelector('.punch-label').textContent = '打卡中...';

  var shifts   = sysSettings.shifts || [];
  var curShift = shifts[currentShiftIndex] || { name: '正常班', start: sysSettings.workStart || '09:00', end: sysSettings.workEnd || '18:00' };

  var promise;
  if (type === 'in') {
    promise = db.collection('records').doc(recId).set({
      empId:      currentUser.uid,
      empName:    currentUserData.name,
      empDept:    currentUserData.dept || '',
      date:       today,
      shiftIndex: currentShiftIndex,
      shiftName:  curShift.name,
      shiftStart: curShift.start,
      shiftEnd:   curShift.end,
      clockIn:    timeStr,
      clockOut:   null,
      lat:        currentPosition.latitude,
      lng:        currentPosition.longitude,
      createdAt:  firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    promise = db.collection('records').doc(recId).update({
      clockOut:   timeStr,
      clockOutAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  promise.then(function() {
    showToast(curShift.name + ' ' + (type === 'in' ? '上班' : '下班') + '打卡成功！' + timeStr, 'success');
    // 下班打卡成功：清除自動補打卡計時器並關閉加班彈窗
    if (type === 'out') {
      if (autoClockOutTimer) { clearTimeout(autoClockOutTimer); autoClockOutTimer = null; }
      pendingAutoClockData = null;
      closeOvertimeDialog();
    }
    loadTodayStatus();
  }).catch(function(e) {
    showToast('打卡失敗，請確認網路連線', 'error');
    btn.disabled = false;
  }).finally(function() {
    btn.querySelector('.punch-label').textContent = type === 'in' ? '上班打卡' : '下班打卡';
  });
}

window.doClock = doClock;

// ============================================================
// 下班時間監控與加班確認
// ============================================================

// 啟動下班監控（每分鐘檢查一次）
function startShiftEndMonitor() {
  if (shiftEndTimer) clearInterval(shiftEndTimer);
  shiftEndAlerted = {};
  checkShiftEnd(); // 立即執行一次
  shiftEndTimer = setInterval(checkShiftEnd, 60000);
}

function stopShiftEndMonitor() {
  if (shiftEndTimer) { clearInterval(shiftEndTimer); shiftEndTimer = null; }
}

// 檢查是否到了下班時間
function checkShiftEnd() {
  if (!currentUser || !currentUserData) return;
  var now    = new Date();
  var today  = fmtDate(now);
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var shifts = sysSettings.shifts || [];

  shifts.forEach(function(shift, idx) {
    var parts    = shift.end.split(':');
    var endMin   = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var alertKey = today + '_' + idx; // 每天每班別只彈一次

    // 已經彈過就跳過
    if (shiftEndAlerted[alertKey]) return;

    // 時間到了下班時間（允許 1 分鐘誤差）
    if (nowMin < endMin) return;

    // 檢查該班別是否已上班且尚未下班
    var recId = today + '_' + currentUser.uid + '_' + idx;
    db.collection('records').doc(recId).get().then(function(snap) {
      if (!snap.exists) return; // 未上班，不處理
      var rec = snap.data();
      if (!rec.clockIn)  return; // 未上班
      if (rec.clockOut)  return; // 已下班

      // 標記已彈出，避免重複
      shiftEndAlerted[alertKey] = true;

      // 將 Firestore 記錄標記為待加班確認
      db.collection('records').doc(recId).update({ isOvertimePending: true });

      // 發送後台通知
      sendOvertimeNotification({
        empId:     currentUser.uid,
        empName:   currentUserData.name,
        empDept:   currentUserData.dept || '',
        date:      today,
        shiftIdx:  idx,
        shiftName: shift.name,
        shiftEnd:  shift.end,
        recId:     recId,
        type:      'overtime_pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 儲存待執行的自動補打卡資料
      pendingAutoClockData = { recId: recId, shiftEnd: shift.end, shiftName: shift.name, shiftIdx: idx };

      // 彈出加班確認彈窗
      showOvertimeDialog(shift, idx, recId);

      // 15 分鐘後自動補打卡
      if (autoClockOutTimer) clearTimeout(autoClockOutTimer);
      autoClockOutTimer = setTimeout(function() {
        doAutoClockOut(recId, shift.end, shift.name);
      }, 15 * 60 * 1000);
    });
  });
}

// 顯示加班確認彈窗
function showOvertimeDialog(shift, shiftIdx, recId) {
  var dlg = document.getElementById('overtimeDialog');
  if (!dlg) return;
  document.getElementById('otShiftName').textContent = shift.name;
  document.getElementById('otShiftEnd').textContent  = shift.end;

  // 啟動 15 分鐘倒數
  var remaining = 15 * 60;
  var otCountEl = document.getElementById('otCountdown');
  if (otCountEl) otCountEl.textContent = '15:00';
  if (window._otCountdownTimer) clearInterval(window._otCountdownTimer);
  window._otCountdownTimer = setInterval(function() {
    remaining--;
    if (remaining <= 0) {
      clearInterval(window._otCountdownTimer);
      if (otCountEl) otCountEl.textContent = '00:00';
      return;
    }
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    if (otCountEl) otCountEl.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }, 1000);

  dlg.style.display = 'flex';
}

function closeOvertimeDialog() {
  var dlg = document.getElementById('overtimeDialog');
  if (dlg) dlg.style.display = 'none';
  if (window._otCountdownTimer) { clearInterval(window._otCountdownTimer); window._otCountdownTimer = null; }
}

// 員工選擇「我要加班」
function confirmOvertime() {
  closeOvertimeDialog();
  // 清除自動補打卡計時器
  if (autoClockOutTimer) { clearTimeout(autoClockOutTimer); autoClockOutTimer = null; }
  // 更新 Firestore 記錄為加班中
  if (pendingAutoClockData) {
    db.collection('records').doc(pendingAutoClockData.recId).update({
      isOvertimePending: false,
      isOvertime: true
    });
    // 更新後台通知為加班確認
    var today = fmtDate(new Date());
    db.collection('notifications')
      .where('empId', '==', currentUser.uid)
      .where('date', '==', today)
      .where('shiftIdx', '==', pendingAutoClockData.shiftIdx)
      .where('type', '==', 'overtime_pending')
      .get().then(function(snap) {
        snap.forEach(function(doc) {
          doc.ref.update({ type: 'overtime_confirmed', isRead: false });
        });
      });
    pendingAutoClockData = null;
  }
  showToast('加班狀態已記錄，請完工後手動進行下班打卡', 'success');
}

// 員工選擇「立即下班打卡」
function doClockOutNow() {
  closeOvertimeDialog();
  if (autoClockOutTimer) { clearTimeout(autoClockOutTimer); autoClockOutTimer = null; }
  doClock('out');
}

// 自動補打卡（寫入標準下班時間）
function doAutoClockOut(recId, shiftEnd, shiftName) {
  closeOvertimeDialog();
  pendingAutoClockData = null;
  // 寫入標準下班時間（非執行時間）
  db.collection('records').doc(recId).update({
    clockOut:          shiftEnd,
    clockOutAt:        firebase.firestore.FieldValue.serverTimestamp(),
    isAutoClockOut:    true,
    isOvertimePending: false
  }).then(function() {
    showToast('「' + shiftName + '」已自動記錄下班（' + shiftEnd + '）', 'success');
    loadTodayStatus();
    // 更新後台通知
    var today = fmtDate(new Date());
    db.collection('notifications')
      .where('recId', '==', recId)
      .where('type', '==', 'overtime_pending')
      .get().then(function(snap) {
        snap.forEach(function(doc) {
          doc.ref.update({ type: 'auto_clocked_out', isRead: false });
        });
      });
  }).catch(function() {
    showToast('自動下班失敗，請手動打卡', 'error');
  });
}

// 發送後台通知
function sendOvertimeNotification(data) {
  db.collection('notifications').add(data).catch(function() {
    // 通知寫入失敗不影響主流程
  });
}

window.confirmOvertime  = confirmOvertime;
window.doClockOutNow    = doClockOutNow;
window.closeOvertimeDialog = closeOvertimeDialog;

// ============================================================
// 後台加班通知監聽
// ============================================================

function startAdminNotifListener() {
  if (overtimeNotifUnsub) { overtimeNotifUnsub(); overtimeNotifUnsub = null; }
  var today = fmtDate(new Date());
  overtimeNotifUnsub = db.collection('notifications')
    .where('date', '==', today)
    .orderBy('createdAt', 'desc')
    .onSnapshot(function(snap) {
      var notifs = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      renderOvertimePanel(notifs);
      // 側邊欄後台待處理通知徽章
      var unread = notifs.filter(function(n) { return !n.isRead; }).length;
      var badge = document.getElementById('notifBadge');
      if (badge) {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'inline-flex' : 'none';
      }
    }, function() { /* 監聽失敗不影響主流程 */ });
}

function renderOvertimePanel(notifs) {
  var panel = document.getElementById('overtimePanel');
  if (!panel) return;

  // 只顯示待處理和自動補打卡的通知
  var active = notifs.filter(function(n) {
    return n.type === 'overtime_pending' || n.type === 'overtime_confirmed' || n.type === 'auto_clocked_out';
  });

  if (active.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  var html = '';
  active.forEach(function(n) {
    var typeLabel, typeClass;
    if (n.type === 'overtime_pending') {
      typeLabel = '待確認'; typeClass = 'badge-orange';
    } else if (n.type === 'overtime_confirmed') {
      typeLabel = '加班中'; typeClass = 'badge-blue';
    } else {
      typeLabel = '自動下班'; typeClass = 'badge-teal';
    }
    var readClass = n.isRead ? 'notif-row-read' : '';
    html += '<div class="notif-row ' + readClass + '">';
    html += '<div class="notif-info">';
    html += '<strong>' + (n.empName||'') + '</strong>';
    html += '<span class="badge ' + typeClass + '" style="margin-left:8px;">' + typeLabel + '</span>';
    html += '<div class="notif-detail">' + (n.shiftName||'') + ' 下班時間 ' + (n.shiftEnd||'') + '</div>';
    html += '</div>';
    if (!n.isRead) {
      html += '<button class="btn btn-sm btn-outline" onclick="dismissNotif(\'' + n.id + '\')">\u5df2處理</button>';
    }
    html += '</div>';
  });
  document.getElementById('overtimePanelBody').innerHTML = html;
}

function dismissNotif(notifId) {
  db.collection('notifications').doc(notifId).update({ isRead: true });
}

window.dismissNotif = dismissNotif;

function loadMyRecords() {
  var month = document.getElementById('myMonthSel').value;
  db.collection('records')
    .where('empId', '==', currentUser.uid)
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date')
    .get()
    .then(function(snap) {
      // 依日期+班別排序
      var records   = snap.docs.map(function(d) { return d.data(); })
        .sort(function(a,b){
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return (a.shiftIndex||0) - (b.shiftIndex||0);
        });
      var container = document.getElementById('myRecordsList');
      if (records.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#aaa;padding:16px;">本月無出勤記錄</p>';
        return;
      }
      var html = '<table class="dt"><thead><tr><th>日期</th><th>上班</th><th>下班</th><th>工時</th></tr></thead><tbody>';
      records.forEach(function(r) {
        var h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        html += '<tr><td>' + r.date + '</td><td>' + (r.clockIn||'--') + '</td><td>' + (r.clockOut||'--') + '</td><td>' + h + '</td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    });
}

window.showMyRecords = function() {
  document.getElementById('myRecordsModal').style.display = 'flex';
  loadMyRecords();
};
window.loadMyRecords = loadMyRecords;

// ============================================================
// 管理員後台
// ============================================================
var dashDate = null;          // 目前概況查看日期
var dashAllRows = [];         // 存放全部資料以供過濾
var dashSortCol = '';         // 目前排序欄
var dashSortAsc = true;       // 排序方向
var liveWorkTimer = null;     // 即時工時計時器

function initAdmin() {
  updateClock();
  setInterval(updateClock, 1000);
  populateMonthSel('recMonth');
  populateMonthSel('expMonth');
  populateMonthSel('expMonthStats');
  dashDate = new Date();
  loadDashboard();
  loadEmployeeList();
  loadSettingsForm();
  // 啟動後台加班通知監聽
  startAdminNotifListener();
}

// 日期導航
function shiftDashDate(delta) {
  if (!dashDate) dashDate = new Date();
  if (delta === 0) {
    dashDate = new Date();
  } else {
    dashDate = new Date(dashDate.getTime() + delta * 86400000);
  }
  // 不能超過今天
  var today = new Date(); today.setHours(23,59,59,999);
  if (dashDate > today) dashDate = new Date();
  loadDashboard();
}
window.shiftDashDate = shiftDashDate;

// 環形進度條輔助函數
function setRing(id, ratio) {
  var el = document.getElementById(id);
  if (!el) return;
  var r = 18, circ = 2 * Math.PI * r;
  var dash = Math.max(0, Math.min(1, ratio)) * circ;
  el.style.strokeDasharray = dash + ' ' + circ;
  el.style.strokeDashoffset = '0';
  el.style.transform = 'rotate(-90deg)';
  el.style.transformOrigin = '50% 50%';
}

function loadDashboard() {
  if (!dashDate) dashDate = new Date();
  var dateStr = fmtDate(dashDate);
  var isToday = (dateStr === fmtDate(new Date()));

  // 更新日期顯示
  var dd = document.getElementById('dashDate');
  if (dd) {
    dd.textContent = dashDate.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
    dd.style.color = isToday ? 'var(--primary)' : '#888';
  }

  // 停止舊的即時工時計時器
  if (liveWorkTimer) { clearInterval(liveWorkTimer); liveWorkTimer = null; }

  Promise.all([
    db.collection('users').get(),
    db.collection('records').where('date', '==', dateStr).get()
  ]).then(function(results) {
    var empSnap = results[0], recSnap = results[1];
    var employees = empSnap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee' && e.active !== false; });
    var records = recSnap.docs.map(function(d) { return d.data(); });
    var total = employees.length;
    var present = 0, left = 0, absent = 0;

    // 判斷是否已過上班時間（用第一個班別開始時間判斷）
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var firstShiftStart = sysSettings.shifts && sysSettings.shifts[0]
      ? (function(s){ var p=s.start.split(':'); return parseInt(p[0])*60+parseInt(p[1]); })(sysSettings.shifts[0])
      : 9 * 60;
    var isLate = isToday && (nowMin > firstShiftStart + 15); // 超過上班時間 15 分鐘後才標記遲到

    dashAllRows = [];
    employees.forEach(function(e) {
      // 取得該員工當天所有班別的記錄
      var empRecs = records.filter(function(rec) { return rec.empId === e.id; })
        .sort(function(a,b){ return (a.shiftIndex||0) - (b.shiftIndex||0); });

      if (empRecs.length === 0) {
        // 完全未打卡
        absent++;
        dashAllRows.push({ emp: e, rec: null, status: 'absent', isLate: isLate, multiShift: false });
      } else {
        // 有打卡記錄：逐班別顯示
        empRecs.forEach(function(r) {
          var status = 'absent';
          if (r.clockIn && r.clockOut) { status = 'left'; left++; }
          else if (r.clockIn) { status = 'present'; present++; }
          dashAllRows.push({ emp: e, rec: r, status: status, isLate: isLate, multiShift: empRecs.length > 1 });
        });
      }
    });

    // 更新 KPI
    document.getElementById('kpiTotal').textContent   = total;
    document.getElementById('kpiPresent').textContent = present;
    document.getElementById('kpiLeft').textContent    = left;
    document.getElementById('kpiAbsent').textContent  = absent;

    // 環形進度條
    var t = total || 1;
    setRing('ringTotal',   1);
    setRing('ringPresent', present / t);
    setRing('ringLeft',    left    / t);
    setRing('ringAbsent',  absent  / t);

    // 渲染表格
    renderDashTable();

    // 即時工時：每分鐘更新一次
    if (isToday && present > 0) {
      liveWorkTimer = setInterval(function() {
        document.querySelectorAll('.live-work-cell').forEach(function(cell) {
          var ci = cell.getAttribute('data-ci');
          if (ci) cell.textContent = '已工作 ' + calcLiveHours(ci);
        });
      }, 60000);
    }
  });
}

function calcLiveHours(clockIn) {
  var now = new Date();
  var parts = clockIn.split(':');
  var startMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  var nowMin   = now.getHours() * 60 + now.getMinutes();
  var diff = nowMin - startMin;
  if (diff < 0) return '0 時 0 分';
  return Math.floor(diff/60) + ' 時 ' + (diff%60) + ' 分';
}

function renderDashTable(filter) {
  filter = filter || 'all';
  var rows = dashAllRows;
  if (filter !== 'all') rows = rows.filter(function(row) { return row.status === filter; });

  // 排序
  if (dashSortCol) {
    rows = rows.slice().sort(function(a, b) {
      var va = dashSortCol === 'name' ? (a.emp.name||'') : (a.emp.dept||'');
      var vb = dashSortCol === 'name' ? (b.emp.name||'') : (b.emp.dept||'');
      return dashSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  var dateStr = fmtDate(dashDate || new Date());
  var isToday = (dateStr === fmtDate(new Date()));
  var html = '';
  rows.forEach(function(row) {
    var e = row.emp, r = row.rec, status = row.status;
    var ci = (r && r.clockIn)  || '--';
    var co = (r && r.clockOut) || '--';
    var dept = e.dept ? e.dept : '<span class="text-missing">未設定</span>';

    // 班別標籤
    var shiftBadge = r && r.shiftName
      ? '<span class="badge badge-blue">' + r.shiftName + '</span>'
      : '<span class="badge badge-gray">未指定</span>';

    // 工時顯示
    var hCell = '';
    if (r && r.clockIn && r.clockOut) {
      hCell = calcHoursStr(r.clockIn, r.clockOut);
      if (r && r.isManual) hCell += ' <span class="badge badge-manual">補登</span>';
    } else if (r && r.clockIn && isToday) {
      hCell = '<span class="live-work-cell" data-ci="' + r.clockIn + '">已工作 ' + calcLiveHours(r.clockIn) + '</span>';
    } else {
      hCell = '--';
    }

    // 狀態標籤
    var badge = '';
    if (status === 'left') {
      badge = '<span class="badge badge-teal">已下班</span>';
    } else if (status === 'present') {
      badge = '<span class="badge badge-green">上班中</span>';
    } else {
      if (row.isLate) {
        badge = '<span class="badge badge-late">未出勤</span>';
      } else {
        badge = '<span class="badge badge-gray">未打卡</span>';
      }
    }

    // 補打卡按鈕（傳入班別索引）
    var shiftIdx2 = r ? (r.shiftIndex !== undefined ? r.shiftIndex : 0) : 0;
    var manualBtn = '<button class="btn btn-sm btn-outline" onclick="openManualClock(\'' + e.id + '\',\'' + e.name.replace(/'/g, "\\'") + '\',' + shiftIdx2 + ')">補登</button>';

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
  document.getElementById('dashBody').innerHTML = html || '<tr><td colspan="7" class="empty-row">沒有符合條件的記錄</td></tr>';
}
window.renderDashTable = renderDashTable;

// 表格過濾
var dashCurrentFilter = 'all';
function filterDashTable(filter, el) {
  dashCurrentFilter = filter;
  document.querySelectorAll('.dash-tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderDashTable(filter);
}
window.filterDashTable = filterDashTable;

// 表格排序
function sortDashTable(col) {
  if (dashSortCol === col) {
    dashSortAsc = !dashSortAsc;
  } else {
    dashSortCol = col;
    dashSortAsc = true;
  }
  renderDashTable(dashCurrentFilter);
}
window.sortDashTable = sortDashTable;

// 補打卡彈窗
function openManualClock(empId, empName, shiftIdx) {
  var dateStr = fmtDate(dashDate || new Date());
  document.getElementById('manualEmpInfo').innerHTML =
    '<div class="manual-emp-badge">' + empName[0] + '</div><div><strong>' + empName + '</strong><br><span style="font-size:12px;color:#888;">補登日期：' + dateStr + '</span></div>';
  document.getElementById('manualDate').value = dateStr;
  document.getElementById('manualClockIn').value  = '';
  document.getElementById('manualClockOut').value = '';
  document.getElementById('manualNote').value     = '';
  document.getElementById('manualClockError').style.display = 'none';

  // 填充班別選單，預選傳入的班別
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

  // 先取得員工資料
  db.collection('users').doc(empId).get().then(function(snap) {
    var empData = snap.exists ? snap.data() : {};
    var payload = {
      empId:      empId,
      empName:    empName,
      empDept:    empData.dept || '',
      date:       date,
      clockIn:    ci,
      clockOut:   co || null,
      shiftName:  shift.name,
      shiftStart: shift.start,
      shiftEnd:   shift.end,
      lat: null, lng: null,
      shiftIndex: shiftIdx,
      isManual:   true,
      note:       note || '手動補登',
      createdAt:  firebase.firestore.FieldValue.serverTimestamp()
    };
    return db.collection('records').doc(recId).set(payload, { merge: true });
  }).then(function() {
    showToast('補登記錄已儲存', 'success');
    closeModal('manualClockModal');
    loadDashboard();
  }).catch(function(e) {
    showError(errEl, '儲存失敗：' + e.message);
  });
}
window.saveManualClock = saveManualClock;

function loadRecords() {
  var month     = document.getElementById('recMonth').value;
  var empFilter = document.getElementById('recEmp').value;
  db.collection('records')
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date', 'desc')
    .get()
    .then(function(snap) {
      // 使用 snap.docs 保留真實的 Firestore doc.id
      var records = snap.docs.map(function(d) {
        return Object.assign({ _docId: d.id }, d.data());
      });
      if (empFilter) records = records.filter(function(r) { return r.empId === empFilter; });
      var html = '';
      records.forEach(function(r) {
        var h    = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        var loc  = r.lat ? (r.lat.toFixed(4) + ', ' + r.lng.toFixed(4)) : '無位置';
        var shift = r.shiftName ? ('<span class="badge badge-blue">' + r.shiftName + '</span>') : '<span class="badge badge-gray">未指定</span>';
        // 直接使用 Firestore 真實 doc.id，不自行組合
        var docId       = r._docId;
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

// ============================================================
// 刪除打卡記錄
// ============================================================
function deleteRecord(recId, empName, date) {
  // 步驟一：安全確認提示，防止主管誤點
  var confirmDelete = confirm(
    '⚠️ 確定要刪除這筆出勤紀錄嗎？\n\n' +
    '員工：' + empName + '\n' +
    '日期：' + date + '\n\n' +
    '刪除後無法復原！'
  );
  if (!confirmDelete) return;

  // 步驟二：找到按鈕元素，禁用防止重複點擊
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = '刪除中...'; }

  // 步驟三：發送刪除請求至 Firebase Firestore
  db.collection('records').doc(recId).delete()
    .then(function() {
      // 步驟四：刪除成功，顯示成功提示並刷新畫面
      showToast('「' + empName + '」 ' + date + ' 的出勤紀錄已成功刪除', 'success');
      loadRecords();   // 重新拉取資料，刷新畫面
      loadDashboard(); // 同步更新今日概況儀表板
    })
    .catch(function(error) {
      // 步驟五：錯誤處理
      console.error('刪除打卡記錄時發生錯誤:', error);
      if (btn) { btn.disabled = false; btn.innerHTML = '🗑 刪除'; }
      if (error.code === 'permission-denied') {
        showToast('權限不足，無法刪除此記錄', 'error');
      } else if (error.code === 'not-found') {
        showToast('記錄不存在，可能已經刪除', 'error');
        loadRecords();
      } else {
        showToast('系統連線失敗，請稍後再試（' + (error.message || error.code) + '）', 'error');
      }
    });
}
window.deleteRecord = deleteRecord;

function loadEmployeeList() {
  db.collection('users').get().then(function(snap) {
    var employees = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee'; });

    // 更新篩選下拉
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
      var isActive  = e.active !== false;
      var hasLeave  = e.leaveDate && e.leaveDate !== '';
      // 狀態判斷：有離職日 → 已離職；停用 → 停用；其他 → 在職
      var statusBadge;
      if (hasLeave) {
        statusBadge = '<span class="badge badge-orange">已離職</span>';
      } else if (!isActive) {
        statusBadge = '<span class="badge badge-gray">停用</span>';
      } else {
        statusBadge = '<span class="badge badge-green">在職</span>';
      }
      html += '<tr>'
        + '<td><strong>' + e.name + '</strong></td>'
        + '<td>' + ((e.phone || (e.email||'').replace(/@wanglu\.local$/, ''))) + '</td>'
        + '<td>' + (e.dept||'') + '</td>'
        + '<td>' + (e.joinDate||'—') + '</td>'
        + '<td>' + (e.leaveDate || '—') + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td class="emp-actions">'
        + '<button class="btn btn-sm btn-outline" onclick="openEditEmpModal(\'' + e.id + '\')">編輯</button> '
        + '<button class="btn btn-sm btn-danger" onclick="toggleEmpStatus(\'' + e.id + '\',' + isActive + ')">' + (isActive ? '停用' : '啟用') + '</button>'
        + '</td></tr>';
    });
    document.getElementById('empBody').innerHTML = html || '<tr><td colspan="7" class="empty-row">尚無員工資料</td></tr>';
  });
}

function createEmployee() {
  var name     = document.getElementById('newEmpName').value.trim();
  var rawPhone = document.getElementById('newEmpEmail').value.trim();
  var email    = rawPhone.includes('@') ? rawPhone : phoneToEmail(rawPhone);
  var pwd      = document.getElementById('newEmpPwd').value;
  var dept     = document.getElementById('newEmpDept').value.trim();
  var joinDate = document.getElementById('newEmpJoin').value;
  var errEl    = document.getElementById('addEmpError');
  if (!name || !rawPhone || !pwd) { showError(errEl, '請填寫姓名、電話號碼與密碼'); return; }
  if (pwd.length < 6)             { showError(errEl, '密碼至少需要 6 個字元'); return; }
  errEl.style.display = 'none';
  auth.createUserWithEmailAndPassword(email, pwd)
    .then(function(cred) {
      return db.collection('users').doc(cred.user.uid).set({
        name: name, email: email, dept: dept,
        joinDate: joinDate, leaveDate: '',
        phone: rawPhone,
        role: 'employee', active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function() {
      showToast('員工 ' + name + ' 建立成功', 'success');
      closeModal('addEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) {
      var msg = e.code === 'auth/email-already-in-use' ? '此電話號碼已有帳號'
        : e.code === 'auth/invalid-email' ? '電話號碼格式不正確'
        : '建立失敗：' + e.message;
      showError(errEl, msg);
    });
}

// ============================================================
// 編輯員工（含離職日）
// ============================================================
function openEditEmpModal(uid) {
  db.collection('users').doc(uid).get().then(function(snap) {
    if (!snap.exists) { showToast('找不到員工資料', 'error'); return; }
    var data = snap.data();
    document.getElementById('editEmpUid').value   = uid;
    document.getElementById('editEmpName').value  = data.name  || '';
    document.getElementById('editEmpDept').value  = data.dept  || '';
    document.getElementById('editEmpJoin').value  = data.joinDate  || '';
    document.getElementById('editEmpLeave').value = data.leaveDate || '';
    document.getElementById('editEmpError').style.display = 'none';
    document.getElementById('editEmpModal').style.display = 'flex';
  });
}

function saveEditEmployee() {
  var uid      = document.getElementById('editEmpUid').value;
  var name     = document.getElementById('editEmpName').value.trim();
  var dept     = document.getElementById('editEmpDept').value.trim();
  var joinDate = document.getElementById('editEmpJoin').value;
  var leaveDate = document.getElementById('editEmpLeave').value;
  var errEl    = document.getElementById('editEmpError');

  if (!name) { showError(errEl, '請填寫員工姓名'); return; }
  errEl.style.display = 'none';

  // 如果有離職日，自動設為停用
  var updateData = {
    name: name,
    dept: dept,
    joinDate: joinDate,
    leaveDate: leaveDate
  };
  if (leaveDate) {
    updateData.active = false;
  }

  db.collection('users').doc(uid).update(updateData)
    .then(function() {
      showToast('員工資料已更新', 'success');
      closeModal('editEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) {
      showError(errEl, '更新失敗：' + e.message);
    });
}

window.openEditEmpModal  = openEditEmpModal;
window.saveEditEmployee  = saveEditEmployee;

function toggleEmpStatus(uid, currentActive) {
  db.collection('users').doc(uid).update({ active: !currentActive })
    .then(function() {
      showToast('員工狀態已更新', 'success');
      loadEmployeeList();
    });
}

function loadSettingsForm() {
  document.getElementById('sLocName').value = sysSettings.locationName;
  document.getElementById('sLat').value     = sysSettings.lat;
  document.getElementById('sLng').value     = sysSettings.lng;
  document.getElementById('sRadius').value  = sysSettings.radius;
  renderShiftRows();
}

// 班別列表渲染
function renderShiftRows() {
  var container = document.getElementById('shiftsContainer');
  if (!container) return;
  var shifts = sysSettings.shifts || [{ name: '正常班', start: '09:00', end: '18:00' }];
  var html = '';
  shifts.forEach(function(s, i) {
    html += '<div class="shift-row" id="shiftRow_' + i + '">';
    html += '<div class="shift-row-name"><input type="text" class="shift-input" id="sShiftName_' + i + '" value="' + s.name + '" placeholder="班別名稱"></div>';
    html += '<div class="shift-row-time">';
    html += '<span class="shift-time-label">上班</span><input type="time" class="shift-input" id="sShiftStart_' + i + '" value="' + s.start + '">';
    html += '<span class="shift-time-sep">–</span>';
    html += '<span class="shift-time-label">下班</span><input type="time" class="shift-input" id="sShiftEnd_' + i + '" value="' + s.end + '">';
    html += '</div>';
    if (shifts.length > 1) {
      html += '<button class="btn btn-sm btn-danger shift-del-btn" onclick="removeShiftRow(' + i + ')">刪除</button>';
    } else {
      html += '<span class="shift-del-placeholder"></span>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
}

// 新增班別列
function addShiftRow() {
  var shifts = sysSettings.shifts || [];
  shifts.push({ name: '新班別', start: '09:00', end: '18:00' });
  sysSettings.shifts = shifts;
  renderShiftRows();
}

// 刪除班別列
function removeShiftRow(index) {
  var shifts = sysSettings.shifts || [];
  if (shifts.length <= 1) { showToast('至少需保留一個班別', 'error'); return; }
  shifts.splice(index, 1);
  sysSettings.shifts = shifts;
  renderShiftRows();
}

// 儲存班別設定
function saveShiftSettings() {
  var container = document.getElementById('shiftsContainer');
  var rows = container.querySelectorAll('.shift-row');
  var shifts = [];
  var valid = true;
  rows.forEach(function(row, i) {
    var name  = document.getElementById('sShiftName_'  + i).value.trim();
    var start = document.getElementById('sShiftStart_' + i).value;
    var end   = document.getElementById('sShiftEnd_'   + i).value;
    if (!name)  { showToast('班別名稱不能為空', 'error'); valid = false; return; }
    if (!start || !end) { showToast('請填寫完整的上下班時間', 'error'); valid = false; return; }
    shifts.push({ name: name, start: start, end: end });
  });
  if (!valid || shifts.length === 0) return;
  sysSettings.shifts    = shifts;
  // 對齊舊欄位（相容性）
  sysSettings.workStart = shifts[0].start;
  sysSettings.workEnd   = shifts[0].end;
  db.collection('settings').doc('main').set(sysSettings, { merge: true })
    .then(function() {
      showToast('班別設定已儲存', 'success');
      renderShiftRows();
    })
    .catch(function() { showToast('儲存失敗，請確認網路連線', 'error'); });
}

window.addShiftRow    = addShiftRow;
window.removeShiftRow = removeShiftRow;
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
    .catch(function() { showToast('儲存失敗，請確認網路連線', 'error'); });
}

function saveTimeSettings() {
  // 已被 saveShiftSettings 取代，保留相容
  saveShiftSettings();
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast('裝置不支援 GPS', 'error'); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    document.getElementById('sLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('sLng').value = pos.coords.longitude.toFixed(6);
    showToast('已取得目前位置座標', 'success');
  }, function() { showToast('無法取得位置，請確認定位權限', 'error'); });
}

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
    var records  = results[1].docs.map(function(d) { return d.data(); });
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
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ============================================================
// UI 工具
// ============================================================
function switchTab(tabName, el) {
  document.querySelectorAll('.tab-section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-link').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('tab-' + tabName).classList.add('active');
  el.classList.add('active');
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  if (tabName === 'dashboard')  loadDashboard();
  if (tabName === 'records')    loadRecords();
  if (tabName === 'employees')  loadEmployeeList();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

function openAddEmpModal() {
  document.getElementById('newEmpName').value  = '';
  document.getElementById('newEmpEmail').value = '';
  document.getElementById('newEmpPwd').value   = '123456';
  document.getElementById('newEmpDept').value  = '';
  document.getElementById('newEmpJoin').value  = fmtDate(new Date());
  document.getElementById('addEmpError').style.display = 'none';
  document.getElementById('addEmpModal').style.display = 'flex';
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeModalOverlay(id, e) { if (e.target.id === id) closeModal(id); }

function showToast(msg, type) {
  type = type || '';
  var c = document.getElementById('toastContainer');
  var t = document.createElement('div');
  t.className   = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
}

function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

function hideScreen(id) { document.getElementById(id).classList.remove('active'); }

function populateMonthSel(selId) {
  var sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '';
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
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

// 暴露給 HTML onclick
window.switchTab          = switchTab;
window.toggleSidebar      = toggleSidebar;
window.openAddEmpModal    = openAddEmpModal;
window.createEmployee     = createEmployee;
window.toggleEmpStatus    = toggleEmpStatus;
window.closeModal         = closeModal;
window.closeModalOverlay  = closeModalOverlay;
window.loadMyRecords      = loadMyRecords;
window.loadRecords        = loadRecords;
window.saveGPSSettings    = saveGPSSettings;
window.saveTimeSettings   = saveTimeSettings;
window.saveShiftSettings  = saveShiftSettings;
window.addShiftRow        = addShiftRow;
window.removeShiftRow     = removeShiftRow;
window.useMyLocation      = useMyLocation;
window.exportAttendanceCSV  = exportAttendanceCSV;
window.exportWorkStatsCSV   = exportWorkStatsCSV;
