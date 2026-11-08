const STATUS_LABELS = {
  pending: "Pending Inspection",
  inspection: "Physical Inspection & Grading",
  listed: "Listed for Sale/Rent",
  closed: "Sold / Rented Out",
};
const STAGES = ["pending", "inspection", "listed", "closed"];
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
let db = null;
let listingTimer;
let allListings = [];
let allSubmissions = [];
const byId = (id) => document.getElementById(id);
const config = window.REENG_CONFIG || {};
const configured =
  config.supabaseUrl?.startsWith("https://")
  && config.supabaseAnonKey
  && config.supabaseAnonKey !== "YOUR_SUPABASE_ANON_KEY";

async function initialize() {
  if (configured && window.supabase?.createClient) {
    db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  bindNavigation();
  bindSubmissionForm();
  bindMarketplace();
  bindAdmin();
  const initialView = location.hash.slice(1);
  if (["marketplace", "submit", "admin"].includes(initialView)) showView(initialView);
  if (db) {
    await loadListings();
  } else {
    showConfigurationMessage();
  }
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showView("marketplace");
      byId("search-input").focus();
    }
    if (event.key === "Escape") document.querySelector(".main-nav").classList.remove("open");
  });
  window.addEventListener("popstate", () => {
    const requestedView = location.hash.slice(1);
    showView(["marketplace", "submit", "admin"].includes(requestedView) ? requestedView : "home", false);
  });
}

function showConfigurationMessage() {
  const message = "Finish the Supabase setup in the README to connect Re-Eng.";
  byId("featured-listings").innerHTML = `<div class="loading-note">${message}</div>`;
  byId("results-count").textContent = message;
  byId("login-message").textContent = message;
  byId("form-message").textContent = message;
  byId("form-message").classList.add("error");
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((control) => {
    control.addEventListener("click", (event) => {
      const target = control.dataset.view;
      if (target === "home" && control.getAttribute("href") === "#how-it-works") {
        event.preventDefault();
        showView("home");
        requestAnimationFrame(() => document.getElementById("how-it-works").scrollIntoView({ behavior: "smooth" }));
      } else if (target === "home" && control.getAttribute("href") === "#about") {
        event.preventDefault();
        showView("home");
        requestAnimationFrame(() => document.getElementById("about").scrollIntoView({ behavior: "smooth" }));
      } else {
        event.preventDefault();
        showView(target);
      }
      document.querySelector(".main-nav").classList.remove("open");
      document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
    });
  });
  document.querySelector(".menu-toggle").addEventListener("click", (event) => {
    const nav = document.querySelector(".main-nav");
    const open = nav.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
}

function showView(name, updateHistory = true) {
  document.querySelectorAll(".view").forEach((view) => {
    const selected = view.id === `view-${name}`;
    view.hidden = !selected;
    view.classList.toggle("active", selected);
  });
  if (updateHistory && location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "marketplace") loadListings();
  if (name === "admin") loadAdmin();
}

function publicListing(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    condition: row.condition,
    grade: row.grade,
    description: row.description,
    listingType: row.listing_type,
    askingPrice: row.asking_price,
    location: row.location,
    photos: (row.photos || []).map((path) => photoUrl(path)),
  };
}

function photoUrl(path) {
  return db.storage.from(config.storageBucket || "reeng-images").getPublicUrl(path).data.publicUrl;
}

async function loadListings() {
  if (!db) return;
  const featured = byId("featured-listings");
  const results = byId("marketplace-listings");
  try {
    const { data, error } = await db
      .from("listings")
      .select("id,name,category,condition,grade,description,listing_type,asking_price,location,photos,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    allListings = data.map(publicListing);
    renderFilteredListings();
    renderListings(featured, allListings.slice(0, 3));
    if (results) {
      byId("results-count").textContent = `${allListings.length} ${allListings.length === 1 ? "tool" : "tools"} ready for another round`;
      byId("marketplace-empty").hidden = allListings.length > 0;
    }
  } catch (error) {
    console.error("Could not load Re-Eng listings:", error);
    featured.innerHTML = '<div class="loading-note">The marketplace is taking a breather. Try refreshing in a moment.</div>';
    if (results) {
      results.innerHTML = "";
      byId("results-count").textContent = "Couldn't load the marketplace. Please try again.";
    }
  }
}

function renderFilteredListings() {
  const results = byId("marketplace-listings");
  if (!results) return;
  const category = byId("category-filter").value;
  const listingType = byId("type-filter").value;
  const search = byId("search-input").value.trim().toLocaleLowerCase();
  const filtered = allListings.filter((item) => {
    const matchesCategory = !category || item.category === category;
    const matchesType = !listingType || item.listingType === listingType;
    const matchesSearch = !search
      || `${item.name} ${item.description} ${item.location}`.toLocaleLowerCase().includes(search);
    return matchesCategory && matchesType && matchesSearch;
  });
  renderListings(results, filtered);
  byId("results-count").textContent = `${filtered.length} ${filtered.length === 1 ? "tool" : "tools"} ready for another round`;
  byId("marketplace-empty").hidden = filtered.length > 0;
}

function renderListings(container, listings) {
  if (!container) return;
  if (!listings.length) {
    container.innerHTML = container.id === "featured-listings"
      ? '<div class="loading-note">New tools are being inspected now. Check back soon.</div>'
      : "";
    return;
  }
  container.innerHTML = listings.map((item, index) => {
    const image = item.photos?.length
      ? `<img class="listing-photo" src="${escapeHtml(item.photos[0])}" alt="${escapeHtml(item.name)}">`
      : `<span class="product-mark ${categoryClass(item.category)}" aria-hidden="true">${categorySymbol(item.category)}</span>`;
    const price = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(item.askingPrice);
    return `<article class="listing-card">
      <div class="listing-image tone-${index % 4}">${image}<span class="condition-pill">GRADE ${escapeHtml(item.grade)}</span></div>
      <div class="listing-detail">
        <div class="listing-category"><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.listingType)}</span></div>
        <h3>${escapeHtml(item.name)}</h3>
        <p class="listing-description">${escapeHtml(item.description)}</p>
        <div class="listing-bottom"><span class="listing-price"><strong>${price}</strong><small>${item.listingType === "Rent" ? "per day · rental" : "one-time · sale"}</small></span><span class="listing-place">${escapeHtml(item.location)}</span></div>
      </div>
    </article>`;
  }).join("");
}

function categoryClass(category) {
  return category === "Mechanical" ? "mechanical" : category === "Architecture" ? "architecture" : "electronics";
}

function categorySymbol(category) {
  return category === "Mechanical" ? "⚙" : category === "Architecture" ? "⌑" : "V";
}

function bindMarketplace() {
  ["search-input", "category-filter", "type-filter"].forEach((id) => {
    byId(id).addEventListener(id === "search-input" ? "input" : "change", () => {
      clearTimeout(listingTimer);
      listingTimer = setTimeout(renderFilteredListings, id === "search-input" ? 220 : 0);
    });
  });
  byId("clear-filters").addEventListener("click", () => {
    byId("search-input").value = "";
    byId("category-filter").value = "";
    byId("type-filter").value = "";
    renderFilteredListings();
  });
  document.querySelector(".search-box kbd").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
}

function bindSubmissionForm() {
  const form = byId("submission-form");
  const photoInput = form.elements.photos;
  photoInput.addEventListener("change", () => {
    const files = [...photoInput.files];
    const list = byId("file-list");
    if (files.length > MAX_PHOTOS) {
      photoInput.value = "";
      list.textContent = `Choose up to ${MAX_PHOTOS} photos.`;
      list.classList.add("error");
      return;
    }
    if (files.some((file) => file.size > MAX_PHOTO_BYTES)) {
      photoInput.value = "";
      list.textContent = "Each photo must be 4 MB or smaller.";
      list.classList.add("error");
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_PHOTO_BYTES) {
      photoInput.value = "";
      list.textContent = "All photos together must total 4 MB or less.";
      list.classList.add("error");
      return;
    }
    list.classList.remove("error");
    list.textContent = files.map((file) => file.name).join(" · ");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = byId("form-message");
    const button = form.querySelector('button[type="submit"]');
    if (!db) {
      showMessage(message, "Finish the Supabase setup in the README before submitting.", true);
      return;
    }
    const photos = [...photoInput.files];
    if (
      photos.length > MAX_PHOTOS
      || photos.some((file) => file.size > MAX_PHOTO_BYTES)
      || photos.reduce((total, file) => total + file.size, 0) > MAX_PHOTO_BYTES
    ) {
      showMessage(message, "Please choose up to 3 photos, 4 MB total.", true);
      return;
    }
    let validImages;
    try {
      validImages = (await Promise.all(photos.map(isSupportedImage))).every(Boolean);
    } catch (error) {
      console.error("Could not read the selected photos:", error);
      showMessage(message, "We couldn't read one of the selected photos. Please choose it again.", true);
      return;
    }
    if (!validImages) {
      showMessage(message, "Photos must be valid JPEG, PNG, or WebP images.", true);
      return;
    }
    button.disabled = true;
    button.textContent = "Sending for review…";
    showMessage(message, "");
    try {
      const uploadedPaths = [];
      for (const file of photos) {
        const extension = file.name.split(".").pop().toLowerCase();
        const path = `${crypto.randomUUID()}.${extension}`;
        const { error } = await db.storage.from(config.storageBucket || "reeng-images").upload(path, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        uploadedPaths.push(path);
      }

      const now = new Date().toISOString();
      const values = new FormData(form);
      const { error } = await db.from("submissions").insert({
        name: values.get("name").trim(),
        category: values.get("category"),
        condition: values.get("condition"),
        description: values.get("description").trim(),
        contact_name: values.get("contact_name").trim(),
        email: values.get("email").trim(),
        phone: values.get("phone").trim(),
        location: values.get("location").trim(),
        photos: uploadedPaths,
        status: "pending",
        created_at: now,
        updated_at: now,
      });
      if (error) throw error;
      form.reset();
      byId("file-list").textContent = "";
      showMessage(message, "You're all set! Your tool is now Pending Inspection. Our team will be in touch.");
      showToast("Submission received — thanks for giving good gear another life.");
    } catch (error) {
      console.error("Could not submit tool:", error);
      showMessage(message, "We couldn't send your submission. Please check your connection and try again.", true);
    } finally {
      button.disabled = false;
      button.innerHTML = 'Send for review <span>↗</span>';
    }
  });
}

async function isSupportedImage(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const signatures = {
    jpg: { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    jpeg: { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    png: { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    webp: { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  };
  const signature = signatures[extension];
  if (!signature || file.type !== signature.type) return false;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!signature.bytes.every((byte, index) => bytes[index] === byte)) return false;
  return extension !== "webp"
    || String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function bindAdmin() {
  byId("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("login-message");
    showMessage(message, "");
    if (!db) {
      showMessage(message, "Finish the Supabase setup in the README before signing in.", true);
      return;
    }
    try {
      const { data, error } = await db.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      });
      if (error) throw error;
      const { data: membership, error: membershipError } = await db
        .from("admin_users")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        await db.auth.signOut();
        throw new Error("This account does not have Re-Eng admin access.");
      }
      form.reset();
      setAdminState(true);
      await loadAdmin();
    } catch (error) {
      showMessage(message, error.message || "Sign-in failed. Check your email and password.", true);
    }
  });
  byId("admin-logout").addEventListener("click", async () => {
    const { error } = await db.auth.signOut();
    if (error) {
      showToast(error.message);
      return;
    }
    allSubmissions = [];
    setAdminState(false);
  });
  byId("admin-status-filter").addEventListener("change", renderAdminSubmissions);
  byId("admin-submissions").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-id]");
    if (!button || !db) return;
    const card = button.closest(".submission-card");
    const payload = {
      status: card.querySelector("[name=status]").value,
      updated_at: new Date().toISOString(),
    };
    const grade = card.querySelector("[name=grade]").value;
    const listingType = card.querySelector("[name=listing_type]").value;
    const price = card.querySelector("[name=asking_price]").value;
    if (grade) payload.grade = grade;
    if (listingType) payload.listing_type = listingType;
    if (price) payload.asking_price = Number(price);
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const { error } = await db.from("submissions").update(payload).eq("id", button.dataset.saveId);
      if (error) throw error;
      showToast("Submission updated.");
      await loadAdmin();
      await loadListings();
    } catch (error) {
      showToast(error.message || "Couldn't update this submission.");
      button.disabled = false;
      button.textContent = "Save changes";
    }
  });
}

async function loadAdmin() {
  if (!db) {
    setAdminState(false);
    return;
  }
  try {
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) {
      setAdminState(false);
      return;
    }
    const { data: membership, error: membershipError } = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      await db.auth.signOut();
      setAdminState(false);
      showMessage(byId("login-message"), "This account does not have Re-Eng admin access.", true);
      return;
    }
    setAdminState(true);
    const { data, error } = await db.from("submissions").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    allSubmissions = data.map(adminSubmission);
    const counts = Object.fromEntries(STAGES.map((status) => [
      status,
      allSubmissions.filter((submission) => submission.status === status).length,
    ]));
    renderAdminStats(counts);
    renderAdminSubmissions();
    byId("admin-error").textContent = "";
  } catch (error) {
    console.error("Could not load the Re-Eng operations dashboard:", error);
    byId("admin-error").textContent = error.message || "Couldn't load submissions. Please try again.";
  }
}

function adminSubmission(row) {
  return {
    ...publicListing(row),
    status: row.status,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

function setAdminState(authenticated) {
  byId("admin-login-card").hidden = authenticated;
  byId("admin-dashboard").hidden = !authenticated;
  byId("admin-logout").hidden = !authenticated;
}

function renderAdminStats(counts) {
  byId("dashboard-stats").innerHTML = STAGES.map((status) =>
    `<div class="stat-card ${status === "pending" ? "active" : ""}"><span>${STATUS_LABELS[status]}</span><strong>${counts[status] || 0}</strong></div>`
  ).join("");
}

function renderAdminSubmissions() {
  const selected = byId("admin-status-filter").value;
  const submissions = allSubmissions.filter((item) => !selected || item.status === selected);
  const list = byId("admin-submissions");
  byId("admin-empty").hidden = submissions.length > 0;
  list.innerHTML = submissions.map((item) => {
    const thumbnail = item.photos?.length
      ? `<img src="${escapeHtml(item.photos[0])}" alt="">`
      : `<span>${categorySymbol(item.category)}</span>`;
    const statusOptions = STAGES.map((status) => `<option value="${status}" ${status === item.status ? "selected" : ""}>${STATUS_LABELS[status]}</option>`).join("");
    const gradeOptions = ["", "A", "B", "C", "For parts"].map((grade) => `<option value="${grade}" ${grade === (item.grade || "") ? "selected" : ""}>${grade || "Choose grade"}</option>`).join("");
    const typeOptions = ["", "Sale", "Rent"].map((type) => `<option value="${type}" ${type === (item.listingType || "") ? "selected" : ""}>${type || "Choose type"}</option>`).join("");
    return `<article class="submission-card">
      <div class="submission-card-main">
        <div class="submission-thumb">${thumbnail}</div>
        <div><div class="submission-titleline"><h3>${escapeHtml(item.name)}</h3><span class="submission-category">${escapeHtml(item.category)}</span></div>
          <div class="submission-meta"><span>${escapeHtml(item.condition)} condition</span><span>⌖ ${escapeHtml(item.location)}</span><span>${formatDate(item.createdAt)}</span></div>
        </div>
        <span class="submission-status ${item.status}">${STATUS_LABELS[item.status]}</span>
      </div>
      <p class="submission-description">${escapeHtml(item.description)}</p>
      <div class="submission-contact"><span>Contact: ${escapeHtml(item.contactName)}</span><a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>${item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ""}</div>
      <div class="submission-actions">
        <label class="admin-control"><span>Workflow stage</span><select name="status">${statusOptions}</select></label>
        <label class="admin-control"><span>Inspection grade</span><select name="grade">${gradeOptions}</select></label>
        <label class="admin-control"><span>Sale / rent</span><select name="listing_type">${typeOptions}</select></label>
        <label class="admin-control"><span>Price · USD</span><input name="asking_price" type="number" min="0.01" max="1000000" step="0.01" value="${item.askingPrice || ""}" placeholder="0.00"></label>
        <button class="admin-save" data-save-id="${item.id}">Save changes</button>
      </div>
    </article>`;
  }).join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3800);
}

initialize();
