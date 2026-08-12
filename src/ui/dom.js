/**
 * dom.js
 *
 * Minimal DOM helpers. The previous UI built elements by hand and assigned
 * dozens of inline styles per node; everything visual now lives in styles.css
 * and these helpers just produce structure.
 */

/**
 * Create an element.
 * @param {string} tag - Tag name, optionally with classes: 'div.foo.bar'
 * @param {Object} [props] - Properties/attributes to apply
 * @param {Array|string|Node} [children] - Child nodes or text
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const [tagName, ...classes] = tag.split('.');
  const node = document.createElement(tagName);

  if (classes.length) {
    node.className = classes.join(' ');
  }

  Object.entries(props).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      return;
    }

    if (key === 'class') {
      node.className = node.className ? `${node.className} ${value}` : value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  });

  toArray(children).forEach(child => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });

  return node;
}

/** Normalise a value into an array */
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/** Replace all children of a node */
export function replace(parent, children) {
  parent.replaceChildren(...toArray(children).filter(Boolean));
  return parent;
}

/** Format a number as whole-dollar currency */
export function money(amount) {
  const rounded = Math.round(amount * 100) / 100;
  const whole = Number.isInteger(rounded) ? rounded : rounded.toFixed(2);
  return `$${whole.toLocaleString('en-US')}`;
}

/** Format a count with an explicit sign, since +2 and -2 mean opposite things */
export function signed(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** Short vibration for tactile feedback, where the device supports it */
export function buzz(pattern = 8) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration is a nicety; never let it break a turn
    }
  }
}
