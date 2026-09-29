/** Navegação por teclado/mouse numa lista de botões. */
export function createList(container, onPick, onMove) {
  const items = () => [...container.querySelectorAll("button")];
  let index = 0;
  const mark = () => items().forEach((b, i) => b.classList.toggle("on", i === index));
  container.addEventListener("pointerover", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    index = items().indexOf(b);
    mark();
    onMove?.(b);
  });
  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) onPick(b, 0);
  });
  mark();
  return {
    key(e) {
      const list = items();
      if (e.code === "ArrowDown" || e.code === "ArrowUp") {
        index = (index + (e.code === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        mark();
        onMove?.(list[index]);
        return true;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        onPick(list[index], e.code === "ArrowRight" ? 1 : -1);
        return true;
      }
      if (e.code === "Enter") {
        onPick(list[index], 0);
        return true;
      }
      return false;
    },
    reset() { index = 0; mark(); },
  };
}

export function renderStats(dl, rows) {
  dl.innerHTML = rows.map(([label, value, cls = ""]) => `<div><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`).join("");
}
