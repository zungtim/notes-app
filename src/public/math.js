// Offline TeX subset rendered as native MathML. No scripts, URLs, or raw HTML
// are accepted from the formula. Unsupported syntax remains readable as text.
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const symbols = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', hbar: 'ℏ', ell: 'ℓ', partial: '∂', nabla: '∇',
  times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', simeq: '≃', sim: '∼', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮',
  langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', lbrace: '{', rbrace: '}',
  cdots: '⋯', ldots: '…', dots: '…', degree: '°', circ: '∘', prime: '′', lceil: '⌈', rceil: '⌉',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅'
});
const identifiers = new Set(['infty', 'hbar', 'ell', 'partial', 'nabla', ...Object.keys(symbols).filter(name => /^[A-Za-z]+$/.test(name) && /[α-ωΑ-Ωϵϑϖϱϕℓ]/u.test(symbols[name]))]);
const functions = new Set(['exp', 'ln', 'log', 'sin', 'cos', 'tan', 'cot', 'sinh', 'cosh', 'tanh', 'lim', 'min', 'max', 'det']);
const row = nodes => `<mrow>${nodes.join('')}</mrow>`;

class FormulaParser {
  constructor(source) {
    if (source.length > 12000) throw new Error('Formula too long');
    this.source = source;
    this.index = 0;
    this.depth = 0;
    this.steps = 0;
  }
  skipSpace() { while (/\s/u.test(this.source[this.index] || '') && this.index < this.source.length) this.index++; }
  tick() { if (++this.steps > 4000) throw new Error('Formula too complex'); }
  parse(stop = null) {
    if (++this.depth > 32) throw new Error('Formula nesting too deep');
    const nodes = [];
    while (this.index < this.source.length) {
      this.skipSpace();
      if (this.index === this.source.length) break;
      // Keep matched delimiters in their own row. Otherwise MathML stretches
      // f(x) parentheses to the height of unrelated fractions in the equation.
      const right = this.source.slice(this.index).match(/^\\right(?![A-Za-z])\s*/);
      if (stop && right && this.source[this.index + right[0].length] === stop) this.index += right[0].length;
      if (this.source[this.index] === stop) { this.index++; this.depth--; return row(nodes); }
      if (['}', ')', ']'].includes(this.source[this.index])) throw new Error('Unexpected closing group');
      const atom = this.atom();
      if (atom) nodes.push(this.scripts(atom));
    }
    this.depth--;
    if (stop) throw new Error('Unclosed group');
    return row(nodes);
  }
  group() {
    this.skipSpace();
    if (this.index >= this.source.length) throw new Error('Missing argument');
    if (this.source[this.index] === '{') { this.index++; return this.parse('}'); }
    if (/[0-9]/.test(this.source[this.index])) return `<mn>${this.source[this.index++]}</mn>`;
    return this.atom();
  }
  scripts(base) {
    let sub = null, sup = null;
    this.skipSpace();
    while (this.source[this.index] === '_' || this.source[this.index] === '^') {
      const type = this.source[this.index++];
      if ((type === '_' && sub !== null) || (type === '^' && sup !== null)) throw new Error('Repeated script');
      const argument = this.group();
      if (!argument) throw new Error('Empty script');
      if (type === '_') sub = argument; else sup = argument;
      this.skipSpace();
    }
    return sub !== null && sup !== null ? `<msubsup>${base}${sub}${sup}</msubsup>` : sub !== null ? `<msub>${base}${sub}</msub>` : sup !== null ? `<msup>${base}${sup}</msup>` : base;
  }
  rawGroup() {
    this.skipSpace();
    if (this.source[this.index++] !== '{') throw new Error('Expected text group');
    let depth = 1, text = '';
    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === '{') depth++;
      if (char === '}' && --depth === 0) return text;
      text += char;
    }
    throw new Error('Unclosed text group');
  }
  atom() {
    this.tick();
    this.skipSpace();
    const char = this.source[this.index++];
    if (char === undefined || char === '}' || char === '^' || char === '_') throw new Error('Missing atom');
    if (char === '{') return this.parse('}');
    if (char === '(' || char === '[') {
      const closing = char === '(' ? ')' : ']';
      return `<mrow><mo fence="true">${char}</mo>${this.parse(closing)}<mo fence="true">${closing}</mo></mrow>`;
    }
    if (char === '\\') {
      const tail = this.source.slice(this.index);
      const match = tail.match(/^[A-Za-z]+/);
      if (!match) {
        const escaped = this.source[this.index++];
        if (['{', '}', '%', '#', '$', '&', '_'].includes(escaped)) return `<mo>${escape(escaped)}</mo>`;
        if (escaped === ',') return '<mspace width="0.167em"/>';
        if (escaped === ':' || escaped === ';') return '<mspace width="0.25em"/>';
        if (escaped === ' ') return '<mspace width="0.333em"/>';
        if (escaped === '!') return '';
        throw new Error('Unsupported escape');
      }
      const name = match[0]; this.index += name.length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return `<mfrac>${this.group()}${this.group()}</mfrac>`;
      if (name === 'sqrt') {
        this.skipSpace();
        if (this.source[this.index] === '[') {
          this.index++; const degree = this.parse(']');
          return `<mroot>${this.group()}${degree}</mroot>`;
        }
        return `<msqrt>${this.group()}</msqrt>`;
      }
      if (name === 'text' || name === 'operatorname') return `<mtext>${escape(this.rawGroup())}</mtext>`;
      if (name === 'mathrm' || name === 'textrm') return `<mstyle>${this.group().replace(/<mi>/g, '<mi mathvariant="normal">')}</mstyle>`;
      if (name === 'mathbf' || name === 'boldsymbol') return `<mstyle mathvariant="bold">${this.group()}</mstyle>`;
      if (name === 'mathit') return `<mstyle mathvariant="italic">${this.group()}</mstyle>`;
      if (name === 'mathcal') {
        const letters = this.rawGroup();
        const scriptLetters = { A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ', J: '𝒥', K: '𝒦', L: 'ℒ', M: 'ℳ', N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ', S: '𝒮', T: '𝒯', U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵' };
        if (!/^[A-Z\s]+$/.test(letters)) throw new Error('Unsupported calligraphic argument');
        return row([...letters.replace(/\s/g, '')].map(letter => `<mi>${scriptLetters[letter]}</mi>`));
      }
      if (name === 'left' || name === 'right') {
        this.skipSpace();
        if (this.source[this.index] === '.') { this.index++; return ''; }
        return this.atom();
      }
      if (name === 'displaystyle' || name === 'textstyle' || name === 'limits' || name === 'nolimits') return '';
      if (name === 'quad' || name === 'qquad') return `<mspace width="${name === 'quad' ? '1' : '2'}em"/>`;
      if (name === 'overline' || name === 'bar') return `<mover accent="true">${this.group()}<mo>¯</mo></mover>`;
      if (name === 'hat') return `<mover accent="true">${this.group()}<mo>^</mo></mover>`;
      if (name === 'vec') return `<mover accent="true">${this.group()}<mo>→</mo></mover>`;
      if (name === 'boxed') return `<menclose notation="box">${this.group()}</menclose>`;
      if (functions.has(name)) return `<mi mathvariant="normal">${name}</mi>`;
      if (Object.hasOwn(symbols, name)) return `<${identifiers.has(name) ? 'mi' : 'mo'}>${symbols[name]}</${identifiers.has(name) ? 'mi' : 'mo'}>`;
      throw new Error(`Unsupported command: ${name}`);
    }
    if (/[0-9]/.test(char)) {
      const tail = this.source.slice(this.index).match(/^[0-9]*(?:\.[0-9]+)?/)[0];
      this.index += tail.length;
      return `<mn>${char}${tail}</mn>`;
    }
    if (/\p{L}/u.test(char)) return `<mi>${escape(char)}</mi>`;
    return `<mo>${escape(char)}</mo>`;
  }
}

export function renderMath(source, { displayMode = false } = {}) {
  const formula = String(source).trim();
  try {
    if (!formula) throw new Error('Empty formula');
    const tree = new FormulaParser(formula).parse();
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${displayMode ? 'block' : 'inline'}"><semantics>${tree}<annotation encoding="application/x-tex">${escape(formula)}</annotation></semantics></math>`;
  } catch {
    return `<code class="math-source" title="此公式保留原式；支持常用分式、上下标和希腊字母">${escape(formula)}</code>`;
  }
}
