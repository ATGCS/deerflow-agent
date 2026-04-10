---
name: stock-explorer
description: "快速股票行情和技术分析工具。提供实时价格、基本面、历史走势图和技术指标（RSI、MACD、布林带）。支持A股、美股、港股。非常适合快速查看市场。"
official: true
---

# Stock Explorer

Quick stock quotes and technical analysis tool for fast market checks.

## Features

- **Real-time Quotes** — Current price, change, percentage
- **Fundamentals** — Market cap, P/E, EPS, ROE
- **Historical Charts** — ASCII chart visualization
- **Technical Indicators** — RSI, MACD, Bollinger Bands, VWAP, ATR
- **Comprehensive Report** — All-in-one summary

## Dependencies

Python packages (install once):

```bash
pip install yfinance pandas rich plotille
```

## Usage

**IMPORTANT:** Always use the `$SKILLS_ROOT` environment variable to locate scripts.

### Quick Quote

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" price AAPL
```

### Fundamentals

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" fundamentals 601288.SS
```

### Historical Chart

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" history AAPL 3mo
```

### Technical Analysis

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" pro 601288.SS 6mo --rsi --macd --bb
```

### Comprehensive Report

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" report AAPL 3mo
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `price` | Real-time quote | `quote.py price AAPL` |
| `fundamentals` | Basic fundamentals | `quote.py fundamentals 601288.SS` |
| `history` | Historical chart | `quote.py history AAPL 3mo` |
| `pro` | Technical indicators | `quote.py pro AAPL 6mo --rsi --macd` |
| `report` | Comprehensive report | `quote.py report AAPL 3mo` |

## Technical Indicators (pro command)

| Flag | Indicator | Description |
|------|-----------|-------------|
| `--rsi` | RSI(14) | Relative Strength Index |
| `--macd` | MACD | Moving Average Convergence Divergence |
| `--bb` | Bollinger Bands | Upper/Middle/Lower bands |
| `--vwap` | VWAP | Volume Weighted Average Price |
| `--atr` | ATR(14) | Average True Range |

## Stock Ticker Formats

- **A-share (Shanghai)**: `600519.SS`, `601288.SS`
- **A-share (Shenzhen)**: `000001.SZ`, `002594.SZ`
- **US stocks**: `AAPL`, `TSLA`, `NVDA`
- **HK stocks**: `0700.HK`, `9988.HK`

## Period Options

| Period | Description |
|--------|-------------|
| `1mo` | 1 month |
| `3mo` | 3 months |
| `6mo` | 6 months |
| `1y` | 1 year |
| `2y` | 2 years |

## Workflow

When user requests quick stock info:

1. **Identify ticker symbol**
   - User may provide company name → use web-search to find ticker
   - A-share: Shanghai = `.SS`, Shenzhen = `.SZ`

2. **Choose appropriate command**
   - Quick price check → `price`
   - Fundamentals → `fundamentals`
   - Technical analysis → `pro` with indicators
   - Full overview → `report`

3. **Execute and present**
   ```bash
   export PYTHONIOENCODING=utf-8
   python "$SKILLS_ROOT/stock-explorer/scripts/quote.py" <command> <ticker>
   ```

## Limitations

- Yahoo Finance data quality varies by market
- Real-time quotes may have 15-min delay
- ASCII charts are basic visualization
- Some indicators need sufficient historical data

## When to Use This Skill

- User asks "XX股票现在多少钱"
- User wants "技术指标" or "技术分析"
- User needs "走势图" or "历史走势"
- Quick market check (vs. stock-analyzer for deep analysis)

## Comparison with stock-analyzer

| Feature | stock-explorer | stock-analyzer |
|---------|---------------|----------------|
| Purpose | Quick check | Deep analysis |
| Output | Concise | Detailed report |
| Scoring | No | Multi-dimensional |
| Strategies | No | Trading strategies |
| Risk assessment | No | Full risk analysis |
