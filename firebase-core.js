// ============================================================
// FILEBAYY — Firebase Core & Utilities
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection,
  addDoc, getDocs, query, where, orderBy, limit, deleteDoc,
  serverTimestamp, increment, onSnapshot, writeBatch, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
  uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAC46Orza78_quA58-jfA1903YC2FpDZOM",
  authDomain: "filebayy.firebaseapp.com",
  projectId: "filebayy",
  storageBucket: "filebayy.firebasestorage.app",
  messagingSenderId: "299898154162",
  appId: "1:299898154162:web:909438daa413de2ffbadab",
  measurementId: "G-4BS6D1FTEV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

// ============================================================
// RAZORPAY (Key ID only — secret stays in Cloud Functions)
// ============================================================
export const RAZORPAY_KEY_ID = "rzp_test_T3lrOFe5JwRA7d";

// ============================================================
// EXPORTS
// ============================================================
export { auth, db, storage, analytics };
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, updateProfile };
export { doc, setDoc, getDoc, updateDoc, collection, addDoc, getDocs, query,
  where, orderBy, limit, deleteDoc, serverTimestamp, increment, onSnapshot,
  writeBatch, getCountFromServer };
export { ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable };
export { logEvent };

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${sanitizeHTML(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'toastIn 0.3s ease reverse'; setTimeout(() => toast.remove(), 280); }, duration);
}

// ============================================================
// INPUT SANITIZATION (XSS Protection)
// ============================================================
export function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

export function sanitizeInput(str) {
  return String(str || '').trim().replace(/[<>]/g, '');
}

// ============================================================
// FORMAT HELPERS
// ============================================================
export function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

export function generateId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ============================================================
// AUTH GUARD
// ============================================================
export function requireAuth(allowedRoles = [], redirectTo = '../index.html') {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = redirectTo;
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { signOut(auth); window.location.href = redirectTo; return; }
        const data = snap.data();
        if (allowedRoles.length && !allowedRoles.includes(data.role)) {
          window.location.href = getDashboardByRole(data.role);
          return;
        }
        if (data.status === 'banned') {
          await signOut(auth);
          window.location.href = redirectTo + '?banned=1';
          return;
        }
        resolve({ user, profile: data });
      } catch (e) {
        console.error('Auth guard error:', e);
        window.location.href = redirectTo;
      }
    });
  });
}

export function getDashboardByRole(role) {
  const map = { buyer: '../pages/buyer-dashboard.html', seller: '../pages/seller-dashboard.html',
    affiliate: '../pages/affiliate-dashboard.html', admin: '../pages/admin-dashboard.html' };
  return map[role] || '../index.html';
}

// ============================================================
// PAGE LOADER HELPERS
// ============================================================
export function showLoader() {
  const el = document.getElementById('page-loader');
  if (el) el.style.display = 'flex';
}

export function hideLoader() {
  const el = document.getElementById('page-loader');
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.style.display = 'none', 300); }
}

// ============================================================
// MODAL HELPERS
// ============================================================
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('active'); document.body.style.overflow = 'hidden'; }
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('active'); document.body.style.overflow = ''; }
}

// Auto-bind close buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
    });
  });
  // Sidebar hamburger
  const ham = document.getElementById('hamburger');
  const sidebarEl = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (ham && sidebarEl) {
    ham.addEventListener('click', () => { sidebarEl.classList.toggle('open'); sidebarOverlay?.classList.toggle('active'); });
    sidebarOverlay?.addEventListener('click', () => { sidebarEl.classList.remove('open'); sidebarOverlay.classList.remove('active'); });
  }
});

// ============================================================
// UPI QR CODE GENERATOR
// ============================================================
export function generateUPIQR(amount, note = '') {
  const upiId = 'balakumarmd9344@okaxis';
  const name = 'Bala Kumar';
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}&aid=uGICAgIDn3oH5Xw`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUrl)}&margin=10&color=000000&bgcolor=ffffff&format=png`;
  return { upiUrl, qrApiUrl };
}

// ============================================================
// FILE VALIDATION
// ============================================================
export function validateImageFile(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return { ok: false, error: 'Only JPG, PNG, WebP, GIF images allowed.' };
  if (file.size > 1 * 1024 * 1024) return { ok: false, error: 'Image must be under 1 MB.' };
  return { ok: true };
}

export function validateProductFile(file) {
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'Product file must be under 5 MB.' };
  return { ok: true };
}

// ============================================================
// STORAGE UPLOAD WITH PROGRESS
// ============================================================
export async function uploadFileWithProgress(file, path, onProgress) {
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file);
  return new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => { const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100); onProgress && onProgress(pct); },
      reject,
      async () => { const url = await getDownloadURL(task.snapshot.ref); resolve(url); }
    );
  });
}

// ============================================================
// AFFILIATE LINK BUILDER
// ============================================================
export function buildAffiliateLink(productId, affiliateId) {
  return window.location.origin + '/pages/product.html?id=' + productId + '&ref=' + affiliateId;
}

// ============================================================
// COMMISSION CALCULATOR
// ============================================================
export function calculateCommission(price, commission) {
  if (!commission) return 0;
  if (typeof commission === 'string' && commission.endsWith('%')) {
    return Math.round(price * parseFloat(commission) / 100 * 100) / 100;
  }
  return parseFloat(commission) || 0;
}

// ============================================================
// WITHDRAWAL CALCULATOR
// ============================================================
export function calculateWithdrawal(amount) {
  const fee = Math.round(amount * 0.02 * 100) / 100;
  const net = Math.round((amount - fee) * 100) / 100;
  return { gross: amount, fee, net };
}
