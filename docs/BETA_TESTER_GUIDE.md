# Beta tester guide

PriceTruth helps you see whether a product's current price looks high, low, or typical compared with recent history PriceTruth has observed.

## What it supports today

- Amazon product pages
- Best Buy product pages

## Install

1. Get the beta ZIP from the owner.
2. Unzip it.
3. In Chrome, open `chrome://extensions`.
4. Turn on Developer mode.
5. Click Load unpacked and choose the unzipped folder.
6. Pin PriceTruth from the extensions menu.

## How to use it

1. Open a normal Amazon or Best Buy product page.
2. Open the PriceTruth side panel.
3. Wait a moment while it reads the visible price and asks the PriceTruth service for history.
4. If PriceTruth is still learning, that means it does not have enough trustworthy history yet.

## What data it collects

When you view a supported product page and a clear price is visible, PriceTruth may send:

- retailer and product id (ASIN or Best Buy SKU)
- page URL and title
- the visible price (and reference/list price when shown)
- when you saw it

## What it does not collect

- your name or account
- passwords
- payment details
- browsing history outside supported product pages
- a permanent device id for tracking you

## Why some products say "still learning"

PriceTruth needs multiple solid observations over time before it can judge a deal. New products, rarely viewed items, or unclear prices will show limited confidence until more real observations arrive.

## How to report an incorrect price

Tell the owner:

- the product URL
- the price you see on the page
- the price PriceTruth showed
- approximate time

## How to uninstall

`chrome://extensions` → PriceTruth → Remove.
