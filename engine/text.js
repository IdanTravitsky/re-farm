// Text is laid out in logical pixels before scaling or typewriter reveal.
export function wrapText(text, width, measure) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (let word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && measure(line + ' ' + word) <= width) { line += ' ' + word; continue; }
      if (line) { lines.push(line); line = ''; }
      // URLs, identifiers and other unbroken words must fit too.
      while (measure(word) > width) {
        let end = 1;
        while (end < word.length && measure(word.slice(0, end + 1)) <= width) end++;
        lines.push(word.slice(0, end)); word = word.slice(end);
      }
      line = word;
    }
    if (line || !paragraph.trim()) lines.push(line);
  }
  return lines;
}
export function paginate(lines, rows) {
  const pages = [];
  for (let i = 0; i < lines.length; i += rows) pages.push(lines.slice(i, i + rows));
  return pages.length ? pages : [[]];
}
export function fitText(text, width, measure) {
  text = String(text ?? '');
  if (measure(text) <= width) return text;
  while (text && measure(text + '...') > width) text = text.slice(0, -1);
  return text + '...';
}
