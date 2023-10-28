/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

//
// Copyright (C) <2023> Miska Tammenpää <miska@tammenpaa.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { browser } from 'webextension-polyfill-ts';

const FILTER_LABELS = ['Course prefix'] as const;

const PREFIX_VALUES = [
  'ARK',
  'ARTS',
  'ARTX',
  'AXM',
  'BIZ',
  'CHEM',
  'CS',
  'ECON',
  'ELEC',
  'ELO',
  'FIN',
  'LC',
  'MARK',
  'MLI',
  'MNGT',
  'MUO',
  'PHYS',
  'SCI',
  'TU',
  'JOIN',
] as const;

const storageChangeEvent = new CustomEvent('storageChanged', { bubbles: true });

const plusIcon = browser.runtime.getURL('plus.svg');
const minusIcon = browser.runtime.getURL('minus.svg');

type TFilterName = (typeof FILTER_LABELS)[number];
type TFilterConfig = {
  initialValue: string;
  initChild: () => Promise<HTMLElement>;
};

const get = (key: string | string[]) => browser.storage.local.get(key);

const set = (obj: Record<string, any>) => browser.storage.local.set(obj);

const el = (tag: string) => document.createElement(tag);

const removePrefix = (filterValue: string, prefix: string) =>
  filterValue
    .split(',')
    .filter(p => p.length > 0 && p !== prefix)
    .join(',');

//
// Query the document for the wrapper element of the existing filters.
// This happens on load so we need to wait for the DOM to be constructed
//
const getFilterContainer = () =>
  new Promise<Element>(async (res, rej) => {
    let container = document
      .getElementsByClassName('filters-container')
      .item(0);

    if (container === null) {
      let i = 0;
      while (i < 100) {
        container = document
          .getElementsByClassName('filters-container')
          .item(0);

        await new Promise(r => setTimeout(r, 5));

        if (container !== null) {
          res(container);
        }
        i++;
      }
    } else {
      res(container);
    }
    rej();
  });

//
// Create <ul> element of multiselect togglable filter options
//
const createMultiselectList = async (options: readonly string[]) => {
  const ul = el('ul');
  ul.className = 'multiselect';
  const { prefixes: initPos, 'not-prefixes': initNeg } = await get([
    'prefixes',
    'not-prefixes',
  ]);

  options.forEach(option => {
    const li = el('li');
    const label = el('label');
    const input = el('input');
    const span = el('span');
    const plus = el('img');
    const minus = el('img');

    plus.setAttribute('src', plusIcon);
    minus.setAttribute('src', minusIcon);

    label.textContent = option;
    li.className = 'multiselect-item';
    span.className = 'checkbox';

    if (initPos?.includes(option)) {
      span.appendChild(plus);
      span.style.backgroundColor = '#202020';
    }
    if (initNeg?.includes(option)) {
      span.appendChild(minus);
      span.style.backgroundColor = '#202020';
    }

    li.addEventListener('click', async () => {
      const { prefixes: pos, 'not-prefixes': neg } = await get([
        'prefixes',
        'not-prefixes',
      ]);

      if (pos?.includes(option)) {
        set({
          'not-prefixes': `${neg ? neg + ',' : ''}${option}`,
          prefixes: removePrefix(pos, option),
        });
        span.removeChild(plus);
        span.appendChild(minus);
        span.style.backgroundColor = '#202020';
      } else if (neg?.includes(option)) {
        set({ 'not-prefixes': removePrefix(neg, option) });
        span.removeChild(minus);
        span.style.backgroundColor = 'white';
      } else {
        set({ prefixes: `${pos ? pos + ',' : ''}${option}` });
        span.appendChild(plus);
        span.style.backgroundColor = '#202020';
      }

      li.dispatchEvent(storageChangeEvent);
    });

    input.setAttribute('c-aaltoinput_radiolist', '');
    li.setAttribute('c-aaltoinput_radiolist', '');
    label.setAttribute('c-aaltoinput_radiolist', '');

    li.appendChild(span);
    li.appendChild(label);

    ul.appendChild(li);
  });

  return ul;
};

const createFilterBox = (label: string) => (child: HTMLElement) => {
  const [wrapper, ...children] = [
    el('div'),
    el('fieldset'),
    el('legend'),
    el('h3'),
  ];

  children.forEach(c => c.setAttribute('c-aaltoinput_radiolist', ''));
  const [fieldset, legend, h3] = children;

  wrapper.id = label;
  h3.textContent = label;
  fieldset.className = 'radio-list';

  legend.appendChild(h3);
  fieldset.appendChild(legend);
  fieldset.appendChild(child);
  wrapper.appendChild(fieldset);

  return wrapper;
};
2;
const configByFilter: Record<TFilterName, TFilterConfig> = {
  ['Course prefix']: {
    initialValue: '',
    initChild: () => createMultiselectList(PREFIX_VALUES),
  },
};

class Filter {
  value: string;
  node: HTMLElement;

  constructor(label: TFilterName, filterComponent: HTMLElement) {
    this.value = configByFilter[label].initialValue;

    this.node = createFilterBox(label)(filterComponent);
  }
}

// ---------------------
const init = () => {
  const reloadButton = el('button');
  reloadButton.id = 'reloadFiltersButton';
  reloadButton.className = 'reload';
  reloadButton.textContent = 'APPLY FILTERS';
  reloadButton.addEventListener('click', () => window.location.reload());

  if (!document.getElementById('reloadFiltersButton')) {
    console.log('adding button');
    setTimeout(() => {
      document.body.appendChild(reloadButton);
    }, 100);
  }

  Promise.all(
    FILTER_LABELS.map(
      async label => new Filter(label, await configByFilter[label].initChild())
    )
  )
    .then(async filters => {
      const filterContainer = await getFilterContainer();
      filters.map(async ({ node }) => {
        if (!document.getElementById(node.id)) filterContainer.prepend(node);
      });
    })
    .finally(async () =>
      (await getFilterContainer()).addEventListener(
        'storageChanged',
        async () => {
          reloadButton.style.display = 'initial';
        }
      )
    );
};

browser.runtime.onMessage.addListener(msg => {
  if (msg === 'loadComplete') {
    init();
  }
});
