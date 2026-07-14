(() => {
  const cards = [...document.querySelectorAll("[data-gallery] [data-src]")];
  const dialog = document.querySelector("[data-lightbox]");
  if (!dialog || !cards.length) return;
  const image = dialog.querySelector("[data-lightbox-image]");
  let index = 0;
  const show = (next) => {
    index = (next + cards.length) % cards.length;
    image.src = cards[index].dataset.src;
    image.classList.remove("zoomed");
  };
  cards.forEach((card, itemIndex) => card.addEventListener("click", () => { show(itemIndex); dialog.showModal(); }));
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-prev]").addEventListener("click", () => show(index - 1));
  dialog.querySelector("[data-next]").addEventListener("click", () => show(index + 1));
  dialog.querySelector("[data-zoom]").addEventListener("click", () => image.classList.toggle("zoomed"));
})();
