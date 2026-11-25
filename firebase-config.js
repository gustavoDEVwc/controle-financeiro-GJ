// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBG77aD4g-k96Wy9irxUV3H3GybaL29PbY",
  authDomain: "controle-financeiro-gj.firebaseapp.com",
  projectId: "controle-financeiro-gj",
  storageBucket: "controle-financeiro-gj.firebasestorage.app",
  messagingSenderId: "444712593919",
  appId: "1:444712593919:web:448478548d40dd24f39fca"
};
export const appId = "financas-casal-gustavo-jessica";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);