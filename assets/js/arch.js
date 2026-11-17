// Architecture drawers: native <dialog> for focus trapping and Escape, one per client card.
// Plus the copy-email fallback for machines without a desktop mail client.
const dialogs = {
  total: document.querySelector("#arch-total"),
  tegna: document.querySelector("#arch-tegna"),
};

for (const button of document.querySelectorAll("[data-arch]")) {
  button.addEventListener("click", () => {
    const dialog = dialogs[button.dataset.arch];
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector(".arch__close")?.focus();
  });
}

for (const dialog of document.querySelectorAll("dialog.arch")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  for (const closer of dialog.querySelectorAll("[data-close]")) {
    closer.addEventListener("click", () => dialog.close());
  }
}

const copy = document.querySelector("[data-copy-email]");
copy?.addEventListener("click", async () => {
  const email = "nitindabas1000@gmail.com";
  let ok = true;
  try {
    await navigator.clipboard.writeText(email);
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = email;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      ok = document.execCommand("copy");
      field.remove();
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    window.location.href = `mailto:${email}`;
    return;
  }
  const label = copy.textContent;
  copy.textContent = "Copied";
  setTimeout(() => { copy.textContent = label; }, 1800);
});
