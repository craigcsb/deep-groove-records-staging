// Shared cart + tracking helpers for the CJA/AJO learning site.
// This file assumes products-data.js is loaded first.

/* ---------- Cart (localStorage-backed, no backend) ---------- */

const CART_KEY = "deepgroove_cart";

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(product, qty) {
  qty = qty || 1;
  const cart = getCart();
  const existing = cart.find(function (item) { return item.id === product.id; });
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ id: product.id, sku: product.sku, name: product.name, price: product.price, qty: qty });
  }
  saveCart(cart);
}

function removeFromCart(productId) {
  const cart = getCart().filter(function (item) { return item.id !== productId; });
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadge();
}

function cartTotal(cart) {
  return cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
}

function cartItemCount(cart) {
  return cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
}

function formatPrice(n) {
  return "$" + n.toFixed(2);
}

function updateCartBadge() {
  const badge = document.querySelector("[data-cart-badge]");
  if (badge) {
    badge.textContent = cartItemCount(getCart());
  }
}

/* ---------- Web SDK / Adobe Experience Platform tracking ----------
   Every function below wraps a call to `alloy("sendEvent", { xdm: {...} })`.
   `alloy` is defined by the Data Collection / Web SDK embed code you paste
   into the <head> of each page (see the site README and Build Guide Phase 3).
   Until you've pasted that code in, these calls are safely skipped and
   logged to the console instead, so the site works either way. */

function hasAlloy() {
  return typeof window.alloy === "function";
}

function sendXdmEvent(xdm) {
  const crmMap = crmIdentityMap();
  if (crmMap) {
    // Signed in: attach the authenticated CRM ID to every event, not just
    // purchases — that's what makes it a realistic authenticated identity
    // rather than a one-off. It's the strongest identity signal we have, so
    // demote any other identity (e.g. the guest-checkout Email) on this
    // event to non-primary rather than leaving two identities flagged primary.
    xdm.identityMap = Object.assign({}, xdm.identityMap, crmMap);
    Object.keys(xdm.identityMap).forEach(function (namespace) {
      if (namespace === "crmId") return;
      xdm.identityMap[namespace] = xdm.identityMap[namespace].map(function (entry) {
        return Object.assign({}, entry, { primary: false });
      });
    });
  }

  if (hasAlloy()) {
    window.alloy("sendEvent", { xdm: xdm }).catch(function (err) {
      console.warn("[tracking] alloy sendEvent failed:", err);
    });
  } else {
    console.info("[tracking] (alloy not installed yet — would have sent):", xdm);
  }
}

/* ---------- Identity: email → identityMap ----------
   Emails are hashed (SHA-256, lowercased + trimmed) before they ever leave
   the browser — Adobe's identity graph and any downstream Audience Manager
   / destination matching expect hashed PII, not raw addresses. Uses the
   native SubtleCrypto API, so no extra library is needed; it requires a
   secure context, which GitHub Pages (HTTPS) satisfies. */

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

// Returns a Promise<identityMap> for a typed-in checkout email, or null if
// none was given. authenticatedState is "ambiguous" (not "authenticated")
// because this is a guest-checkout field, not a real login.
function emailIdentityMap(email) {
  if (!email || !email.trim()) {
    return null;
  }
  return sha256Hex(email.trim().toLowerCase()).then(function (hashedEmail) {
    return {
      Email: [{ id: hashedEmail, authenticatedState: "ambiguous", primary: true }]
    };
  });
}

/* ---------- Mock authentication (CRM ID) ----------
   No real backend, no password — just enough to demonstrate a genuinely
   authenticated identity (as opposed to the guest-checkout email, which is
   only ever "ambiguous"). The CRM ID is derived deterministically from
   whatever's typed in, so re-"signing in" with the same value always
   resolves to the same ID — useful for repeat-visit identity testing. The
   raw typed value is never sent to AEP, only the derived ID. Requires the
   `crmId` identity namespace to exist in AEP (Identities → Namespaces). */

const CRM_KEY = "deepgroove_crm";

function getCrmSession() {
  try {
    return JSON.parse(localStorage.getItem(CRM_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function crmIdFor(identifier) {
  return sha256Hex(identifier.trim().toLowerCase()).then(function (hash) {
    return "CRM-" + hash.slice(0, 12).toUpperCase();
  });
}

function signIn(identifier) {
  return crmIdFor(identifier).then(function (crmId) {
    localStorage.setItem(CRM_KEY, JSON.stringify({ identifier: identifier.trim(), crmId: crmId }));
    updateAuthUI();
    trackPageView(); // fires immediately with the new identity attached
    return crmId;
  });
}

function signOut() {
  localStorage.removeItem(CRM_KEY);
  updateAuthUI();
}

// Returns an identityMap fragment for the signed-in CRM ID, or null if
// signed out. authenticatedState is "authenticated" — unlike the guest
// checkout email, this represents a real (mock) sign-in.
function crmIdentityMap() {
  const session = getCrmSession();
  if (!session) {
    return null;
  }
  return {
    crmId: [{ id: session.crmId, authenticatedState: "authenticated", primary: true }]
  };
}

function updateAuthUI() {
  const btn = document.querySelector("[data-auth-trigger]");
  if (!btn) {
    return;
  }
  const session = getCrmSession();
  if (session) {
    btn.textContent = "Hi, " + session.identifier + " · Sign Out";
    btn.onclick = signOut;
  } else {
    btn.textContent = "Sign In";
    btn.onclick = openAuthModal;
  }
}

function openAuthModal() {
  if (document.querySelector(".auth-overlay")) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-modal">
      <h2>Sign in</h2>
      <p>Mock sign-in — no password, no backend. Illustrates an authenticated
      identity (CRM ID) attaching to every event, unlike the ambiguous guest
      email at checkout.</p>
      <form id="auth-form">
        <div class="field">
          <label for="auth-identifier">Email or username</label>
          <input class="input" id="auth-identifier" placeholder="you@example.com" required />
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" data-auth-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">Sign in</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      closeAuthModal();
    }
  });
  overlay.querySelector("[data-auth-cancel]").addEventListener("click", closeAuthModal);
  overlay.querySelector("#auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    const identifier = document.getElementById("auth-identifier").value;
    if (!identifier.trim()) {
      return;
    }
    signIn(identifier).then(closeAuthModal);
  });
}

function closeAuthModal() {
  const overlay = document.querySelector(".auth-overlay");
  if (overlay) {
    overlay.remove();
  }
}

function trackPageView() {
  sendXdmEvent({
    eventType: "web.webpagedetails.pageViews"
  });
}

function productToListItem(product, qty) {
  return {
    SKU: product.sku,
    name: product.name,
    priceTotal: +(product.price * (qty || 1)).toFixed(2),
    quantity: qty || 1
  };
}

function trackProductView(product) {
  sendXdmEvent({
    eventType: "commerce.productViews",
    commerce: { productViews: { value: 1 } },
    productListItems: [productToListItem(product, 1)]
  });
}

function trackAddToCart(product, qty) {
  sendXdmEvent({
    eventType: "commerce.productListAdds",
    commerce: { productListAdds: { value: 1 } },
    productListItems: [productToListItem(product, qty)]
  });
}

function trackCheckoutStart(cart) {
  sendXdmEvent({
    eventType: "commerce.checkouts",
    commerce: { checkouts: { value: 1 } },
    productListItems: cart.map(function (item) { return productToListItem(item, item.qty); })
  });
}

function trackPurchase(order, cart, email) {
  const xdm = {
    eventType: "commerce.purchases",
    commerce: {
      purchases: { value: 1 },
      order: {
        purchaseID: order.purchaseID,
        priceTotal: order.priceTotal
      }
    },
    productListItems: cart.map(function (item) { return productToListItem(item, item.qty); })
  };

  const identityMapPromise = emailIdentityMap(email);
  if (identityMapPromise) {
    identityMapPromise.then(function (identityMap) {
      xdm.identityMap = identityMap; // identityMap is an XDM field, not a sendEvent option
      sendXdmEvent(xdm);
    });
  } else {
    sendXdmEvent(xdm);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  updateCartBadge();
  updateAuthUI();
});
