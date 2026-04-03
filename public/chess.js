// Bundled minimal chess.js wrapper - loads the npm module via a simple re-export
// We'll use a standalone Chess implementation for the browser

const Chess = (() => {
  // Piece constants
  const WHITE = 'w', BLACK = 'b';
  const PAWN = 'p', KNIGHT = 'n', BISHOP = 'b', ROOK = 'r', QUEEN = 'q', KING = 'k';

  const SQUARES = [];
  const FILES = 'abcdefgh';
  const RANKS = '12345678';
  for (let r = 7; r >= 0; r--)
    for (let f = 0; f < 8; f++)
      SQUARES.push(FILES[f] + RANKS[r]);

  const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  // Unicode pieces
  const UNICODE = {
    wk: '\u2654', wq: '\u2655', wr: '\u2656', wb: '\u2657', wn: '\u2658', wp: '\u2659',
    bk: '\u265A', bq: '\u265B', br: '\u265C', bb: '\u265D', bn: '\u265E', bp: '\u265F',
  };

  // Starting FEN
  const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function sq2idx(sq) { return (sq.charCodeAt(0) - 97) + (sq.charCodeAt(1) - 49) * 8; }
  function idx2sq(i) { return FILES[i % 8] + RANKS[Math.floor(i / 8)]; }

  class ChessGame {
    constructor(fen) {
      this.reset(fen);
    }

    reset(fen) {
      this._fen = fen || DEFAULT_FEN;
      this._board = new Array(64).fill(null);
      this._turn = WHITE;
      this._castling = { K: true, Q: true, k: true, q: true };
      this._enPassant = null;
      this._halfMoves = 0;
      this._fullMoves = 1;
      this._history = [];
      this._parseFen(this._fen);
    }

    _parseFen(fen) {
      const parts = fen.split(' ');
      const rows = parts[0].split('/');
      this._board.fill(null);
      for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (ch >= '1' && ch <= '8') { f += parseInt(ch); }
          else {
            const color = ch === ch.toUpperCase() ? WHITE : BLACK;
            const type = ch.toLowerCase();
            this._board[(7 - r) * 8 + f] = { type, color };
            f++;
          }
        }
      }
      this._turn = parts[1] || WHITE;
      const c = parts[2] || 'KQkq';
      this._castling = { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') };
      this._enPassant = (parts[3] && parts[3] !== '-') ? parts[3] : null;
      this._halfMoves = parseInt(parts[4]) || 0;
      this._fullMoves = parseInt(parts[5]) || 1;
    }

    fen() {
      let fen = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this._board[r * 8 + f];
          if (!p) { empty++; }
          else {
            if (empty) { fen += empty; empty = 0; }
            fen += p.color === WHITE ? p.type.toUpperCase() : p.type;
          }
        }
        if (empty) fen += empty;
        if (r > 0) fen += '/';
      }
      let c = '';
      if (this._castling.K) c += 'K';
      if (this._castling.Q) c += 'Q';
      if (this._castling.k) c += 'k';
      if (this._castling.q) c += 'q';
      if (!c) c = '-';
      fen += ` ${this._turn} ${c} ${this._enPassant || '-'} ${this._halfMoves} ${this._fullMoves}`;
      return fen;
    }

    turn() { return this._turn; }

    get(sq) { return this._board[sq2idx(sq)]; }

    board() {
      const result = [];
      for (let r = 7; r >= 0; r--) {
        const row = [];
        for (let f = 0; f < 8; f++) {
          row.push(this._board[r * 8 + f]);
        }
        result.push(row);
      }
      return result;
    }

    _isAttacked(idx, byColor) {
      // Check if square idx is attacked by byColor
      const r = Math.floor(idx / 8), f = idx % 8;

      // Pawn attacks
      const pawnDir = byColor === WHITE ? 1 : -1;
      for (const df of [-1, 1]) {
        const nr = r - pawnDir, nf = f + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const p = this._board[nr * 8 + nf];
          if (p && p.color === byColor && p.type === PAWN) return true;
        }
      }

      // Knight attacks
      for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nf = f + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const p = this._board[nr * 8 + nf];
          if (p && p.color === byColor && p.type === KNIGHT) return true;
        }
      }

      // King attacks
      for (let dr = -1; dr <= 1; dr++) {
        for (let df = -1; df <= 1; df++) {
          if (dr === 0 && df === 0) continue;
          const nr = r + dr, nf = f + df;
          if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
            const p = this._board[nr * 8 + nf];
            if (p && p.color === byColor && p.type === KING) return true;
          }
        }
      }

      // Sliding pieces (bishop/rook/queen)
      const directions = [
        { dr: 0, df: 1, types: [ROOK, QUEEN] },
        { dr: 0, df: -1, types: [ROOK, QUEEN] },
        { dr: 1, df: 0, types: [ROOK, QUEEN] },
        { dr: -1, df: 0, types: [ROOK, QUEEN] },
        { dr: 1, df: 1, types: [BISHOP, QUEEN] },
        { dr: 1, df: -1, types: [BISHOP, QUEEN] },
        { dr: -1, df: 1, types: [BISHOP, QUEEN] },
        { dr: -1, df: -1, types: [BISHOP, QUEEN] },
      ];
      for (const { dr, df, types } of directions) {
        let nr = r + dr, nf = f + df;
        while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const p = this._board[nr * 8 + nf];
          if (p) {
            if (p.color === byColor && types.includes(p.type)) return true;
            break;
          }
          nr += dr; nf += df;
        }
      }
      return false;
    }

    _inCheck(color) {
      // Find king
      for (let i = 0; i < 64; i++) {
        const p = this._board[i];
        if (p && p.type === KING && p.color === color) {
          return this._isAttacked(i, color === WHITE ? BLACK : WHITE);
        }
      }
      return false;
    }

    _generateMoves(color, onlyLegal = true) {
      const moves = [];
      const c = color || this._turn;

      for (let i = 0; i < 64; i++) {
        const p = this._board[i];
        if (!p || p.color !== c) continue;

        const r = Math.floor(i / 8), f = i % 8;
        const from = idx2sq(i);

        const addMove = (toIdx, flags = {}) => {
          const to = idx2sq(toIdx);
          const captured = this._board[toIdx];
          if (p.type === PAWN && (Math.floor(toIdx / 8) === 0 || Math.floor(toIdx / 8) === 7)) {
            for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
              moves.push({ from, to, piece: p.type, color: c, captured, promotion: promo, ...flags });
            }
          } else {
            moves.push({ from, to, piece: p.type, color: c, captured, ...flags });
          }
        };

        if (p.type === PAWN) {
          const dir = c === WHITE ? 1 : -1;
          const startRank = c === WHITE ? 1 : 6;
          // Forward
          const fwd = i + dir * 8;
          if (fwd >= 0 && fwd < 64 && !this._board[fwd]) {
            addMove(fwd);
            // Double push
            const dbl = i + dir * 16;
            if (r === startRank && !this._board[dbl]) {
              addMove(dbl, { doublePush: true });
            }
          }
          // Captures
          for (const df of [-1, 1]) {
            const nf = f + df, nr = r + dir;
            if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
              const ti = nr * 8 + nf;
              const target = this._board[ti];
              if (target && target.color !== c) addMove(ti);
              // En passant
              const epSq = this._enPassant;
              if (epSq && idx2sq(ti) === epSq) {
                moves.push({
                  from, to: epSq, piece: PAWN, color: c,
                  captured: { type: PAWN, color: c === WHITE ? BLACK : WHITE },
                  enPassant: true,
                });
              }
            }
          }
        } else if (p.type === KNIGHT) {
          for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
            const nr = r + dr, nf = f + df;
            if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
              const ti = nr * 8 + nf;
              const target = this._board[ti];
              if (!target || target.color !== c) addMove(ti);
            }
          }
        } else if (p.type === KING) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let df = -1; df <= 1; df++) {
              if (dr === 0 && df === 0) continue;
              const nr = r + dr, nf = f + df;
              if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                const ti = nr * 8 + nf;
                const target = this._board[ti];
                if (!target || target.color !== c) addMove(ti);
              }
            }
          }
          // Castling
          const rank = c === WHITE ? 0 : 7;
          const opp = c === WHITE ? BLACK : WHITE;
          if (r === rank && f === 4) {
            // Kingside
            const kFlag = c === WHITE ? 'K' : 'k';
            if (this._castling[kFlag] &&
                !this._board[rank * 8 + 5] && !this._board[rank * 8 + 6] &&
                !this._isAttacked(rank * 8 + 4, opp) &&
                !this._isAttacked(rank * 8 + 5, opp) &&
                !this._isAttacked(rank * 8 + 6, opp)) {
              moves.push({ from, to: idx2sq(rank * 8 + 6), piece: KING, color: c, castling: 'k' });
            }
            // Queenside
            const qFlag = c === WHITE ? 'Q' : 'q';
            if (this._castling[qFlag] &&
                !this._board[rank * 8 + 3] && !this._board[rank * 8 + 2] && !this._board[rank * 8 + 1] &&
                !this._isAttacked(rank * 8 + 4, opp) &&
                !this._isAttacked(rank * 8 + 3, opp) &&
                !this._isAttacked(rank * 8 + 2, opp)) {
              moves.push({ from, to: idx2sq(rank * 8 + 2), piece: KING, color: c, castling: 'q' });
            }
          }
        } else {
          // Sliding pieces
          const dirs = [];
          if (p.type === ROOK || p.type === QUEEN) dirs.push([0,1],[0,-1],[1,0],[-1,0]);
          if (p.type === BISHOP || p.type === QUEEN) dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
          for (const [dr, df] of dirs) {
            let nr = r + dr, nf = f + df;
            while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
              const ti = nr * 8 + nf;
              const target = this._board[ti];
              if (target) {
                if (target.color !== c) addMove(ti);
                break;
              }
              addMove(ti);
              nr += dr; nf += df;
            }
          }
        }
      }

      if (!onlyLegal) return moves;

      // Filter illegal moves (leaving king in check)
      return moves.filter(m => {
        const undo = this._applyMove(m);
        const legal = !this._inCheck(c);
        this._undoMove(m, undo);
        return legal;
      });
    }

    _applyMove(m) {
      const fi = sq2idx(m.from), ti = sq2idx(m.to);
      const undo = {
        board: [...this._board],
        castling: { ...this._castling },
        enPassant: this._enPassant,
        halfMoves: this._halfMoves,
      };

      this._board[ti] = this._board[fi];
      this._board[fi] = null;

      if (m.promotion) {
        this._board[ti] = { type: m.promotion, color: m.color };
      }

      if (m.enPassant) {
        const epCapIdx = m.color === WHITE ? sq2idx(m.to) - 8 : sq2idx(m.to) + 8;
        this._board[epCapIdx] = null;
      }

      if (m.castling) {
        const rank = m.color === WHITE ? 0 : 7;
        if (m.castling === 'k') {
          this._board[rank * 8 + 5] = this._board[rank * 8 + 7];
          this._board[rank * 8 + 7] = null;
        } else {
          this._board[rank * 8 + 3] = this._board[rank * 8 + 0];
          this._board[rank * 8 + 0] = null;
        }
      }

      return undo;
    }

    _undoMove(m, undo) {
      this._board = undo.board;
      this._castling = undo.castling;
      this._enPassant = undo.enPassant;
      this._halfMoves = undo.halfMoves;
    }

    moves({ square, verbose } = {}) {
      let allMoves = this._generateMoves();
      if (square) allMoves = allMoves.filter(m => m.from === square);
      if (verbose) return allMoves.map(m => ({
        from: m.from, to: m.to, piece: m.piece, color: m.color,
        captured: m.captured?.type, promotion: m.promotion,
        san: this._toSan(m),
        flags: (m.captured ? 'c' : '') + (m.enPassant ? 'e' : '') + (m.castling || '') + (m.promotion ? 'p' : ''),
      }));
      return allMoves.map(m => this._toSan(m));
    }

    _toSan(m) {
      if (m.castling === 'k') return 'O-O';
      if (m.castling === 'q') return 'O-O-O';

      let san = '';
      if (m.piece !== PAWN) {
        san += m.piece.toUpperCase();
        // Disambiguation
        const same = this._generateMoves().filter(
          om => om.piece === m.piece && om.to === m.to && om.from !== m.from
        );
        if (same.length > 0) {
          const sameFile = same.some(om => om.from[0] === m.from[0]);
          const sameRank = same.some(om => om.from[1] === m.from[1]);
          if (!sameFile) san += m.from[0];
          else if (!sameRank) san += m.from[1];
          else san += m.from;
        }
      }

      if (m.captured || m.enPassant) {
        if (m.piece === PAWN) san += m.from[0];
        san += 'x';
      }
      san += m.to;
      if (m.promotion) san += '=' + m.promotion.toUpperCase();

      // Check/checkmate
      const undo = this._applyMove(m);
      const opp = m.color === WHITE ? BLACK : WHITE;
      if (this._inCheck(opp)) {
        san += this._generateMoves(opp).length === 0 ? '#' : '+';
      }
      this._undoMove(m, undo);

      return san;
    }

    move(input) {
      let m;
      if (typeof input === 'string') {
        const legal = this._generateMoves();
        m = legal.find(lm => this._toSan(lm) === input);
        if (!m) return null;
      } else {
        // { from, to, promotion }
        const legal = this._generateMoves();
        m = legal.find(lm =>
          lm.from === input.from && lm.to === input.to &&
          (!input.promotion || lm.promotion === input.promotion)
        );
        if (!m) return null;
      }

      const san = this._toSan(m);

      // Save history
      this._history.push({
        move: m,
        fen: this.fen(),
      });

      // Apply move
      const fi = sq2idx(m.from), ti = sq2idx(m.to);
      this._board[ti] = this._board[fi];
      this._board[fi] = null;

      if (m.promotion) {
        this._board[ti] = { type: m.promotion, color: m.color };
      }

      if (m.enPassant) {
        const epCapIdx = m.color === WHITE ? ti - 8 : ti + 8;
        this._board[epCapIdx] = null;
      }

      if (m.castling) {
        const rank = m.color === WHITE ? 0 : 7;
        if (m.castling === 'k') {
          this._board[rank * 8 + 5] = this._board[rank * 8 + 7];
          this._board[rank * 8 + 7] = null;
        } else {
          this._board[rank * 8 + 3] = this._board[rank * 8 + 0];
          this._board[rank * 8 + 0] = null;
        }
      }

      // Update en passant
      if (m.doublePush) {
        const epRank = m.color === WHITE ? 2 : 5;
        this._enPassant = m.from[0] + RANKS[epRank];
      } else {
        this._enPassant = null;
      }

      // Update castling rights
      if (m.piece === KING) {
        if (m.color === WHITE) { this._castling.K = false; this._castling.Q = false; }
        else { this._castling.k = false; this._castling.q = false; }
      }
      if (m.piece === ROOK) {
        if (m.from === 'a1') this._castling.Q = false;
        if (m.from === 'h1') this._castling.K = false;
        if (m.from === 'a8') this._castling.q = false;
        if (m.from === 'h8') this._castling.k = false;
      }
      // If rook captured
      if (m.captured?.type === ROOK) {
        if (m.to === 'a1') this._castling.Q = false;
        if (m.to === 'h1') this._castling.K = false;
        if (m.to === 'a8') this._castling.q = false;
        if (m.to === 'h8') this._castling.k = false;
      }

      // Half moves
      if (m.piece === PAWN || m.captured) this._halfMoves = 0;
      else this._halfMoves++;

      if (m.color === BLACK) this._fullMoves++;
      this._turn = this._turn === WHITE ? BLACK : WHITE;

      return { from: m.from, to: m.to, san, color: m.color, piece: m.piece, captured: m.captured?.type, promotion: m.promotion };
    }

    undo() {
      if (this._history.length === 0) return null;
      const h = this._history.pop();
      this._parseFen(h.fen);
      return h.move;
    }

    history({ verbose } = {}) {
      if (verbose) return this._history.map(h => h.move);
      return this._history.map(h => this._toSan ? h.move : h.move.from + h.move.to);
    }

    isCheck() { return this._inCheck(this._turn); }
    isCheckmate() { return this._inCheck(this._turn) && this._generateMoves().length === 0; }
    isStalemate() { return !this._inCheck(this._turn) && this._generateMoves().length === 0; }
    isDraw() { return this.isStalemate() || this._halfMoves >= 100 || this._isInsufficientMaterial(); }
    isGameOver() { return this.isCheckmate() || this.isDraw(); }

    _isInsufficientMaterial() {
      const pieces = this._board.filter(p => p);
      if (pieces.length <= 2) return true; // K vs K
      if (pieces.length === 3) {
        return pieces.some(p => p.type === BISHOP || p.type === KNIGHT);
      }
      return false;
    }
  }

  ChessGame.UNICODE = UNICODE;
  return ChessGame;
})();

if (typeof module !== 'undefined') module.exports = Chess;
