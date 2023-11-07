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
//

import browser from 'webextension-polyfill';

const FILTER_KEYS = ['periods', 'prefixes'] as const;

const PERIOD_VALUES = ['I', 'II', 'III', 'IV', 'V', 'Summer'] as const;

// Ordered by the amount of courses that there are under each prefix
const PREFIX_VALUES = [
  'ELEC',
  'CHEM',
  'ELO',
  'LC',
  'AXM',
  'CS',
  'ARK',
  'MUO',
  'TU',
  'MS',
  'ARTS',
  'MEC',
  'MLI',
  'PHYS',
  'MNGT',
  'AAE',
  'CIV',
  'MAR',
  'ABL',
  'ECON',
  'NBE',
  'ARTX',
  'BIZ',
  'ISM',
  'ENG',
  'GEO',
  'WAT',
  'GIS',
  'REC',
  'SCI',
  'JOIN',
  'COE',
  'KEY',
  'FIN',
  'KIG',
  'KON',
  'MARK',
] as const;

const plusIcon = browser.runtime.getURL('plus.svg');
const minusIcon = browser.runtime.getURL('minus.svg');

type TFilterKey = (typeof FILTER_KEYS)[number];
type TFilterConfig = {
  label: string;
  initChild: () => Promise<HTMLElement>;
};

const get = (key: string | string[]) => browser.storage.local.get(key);

const set = (obj: Record<string, any>) => browser.storage.local.set(obj);

const el = (tag: string) => document.createElement(tag);

//
// The HTML in courses.aalto (or at least the course codes) has non-UTF-8
// encoding. This is a hack to fix that
//
const fixStrangeEncoding = (str: string | null | undefined) => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(`${str}`);
  return decoder.decode(bytes.slice(1, bytes.length - 1));
};

//
// The extension adds a 'Period' filter but a 'Periods' filter
// (with no functionality) exists. Remove it
//
const removeDefaultPeriodsFilter = () => {
  const collection = document.getElementsByTagName('h3');
  let i = 0;
  let found = false;
  while (!found && collection.item(i) !== null) {
    if (collection.item(i)?.textContent === 'Periods') {
      found = true;
      collection.item(i)?.parentElement?.parentElement?.parentElement?.remove();
    }
    i++;
  }
};

//
// The listed courses don't display data for which period the course
// is held in. This adds that data to the listing
//
const injectPeriodElements = async () => {
  const { coursePeriods } = (await get('coursePeriods')) as {
    coursePeriods: Record<string, string>;
  };

  const collection = document.getElementsByClassName('list-item');
  let i = 0;

  while (collection.item(i) !== null) {
    const courseCode = fixStrangeEncoding(
      collection.item(i)?.childNodes[1]?.textContent
    );
    const period = coursePeriods[courseCode];

    if (period !== undefined) {
      const span = el('span');
      span.id = courseCode;
      span.textContent = `Period: ${period}`;
      span.className = 'period-tag';
      if (!document.getElementById(courseCode)) {
        collection.item(i)?.appendChild(span);
      }
    }
    i++;
  }
};

//
// Create <ul> element of multiselect togglable filter options
//
const createMultiselectList = async (
  filterKey: string,
  options: readonly string[]
) => {
  const negFilterKey = `not-${filterKey}`;
  const ul = el('ul');
  ul.className = `multiselect${
    filterKey === 'prefixes' ? ' filter-prefixes' : ''
  }`;
  const { [filterKey]: initPos, [negFilterKey]: initNeg } = await get([
    filterKey,
    negFilterKey,
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

    if ((initPos || []).includes(option)) {
      span.appendChild(plus);
      span.style.backgroundColor = '#202020';
    }
    if ((initNeg || []).includes(option)) {
      span.appendChild(minus);
      span.style.backgroundColor = '#202020';
    }

    li.addEventListener('click', async () => {
      const { [filterKey]: pos = [], [negFilterKey]: neg = [] } = await get([
        filterKey,
        negFilterKey,
      ]);

      if (pos.includes(option)) {
        await set({
          [negFilterKey]: [...neg, option],
          [filterKey]: pos.filter((v: string) => v !== option),
        });
        span.removeChild(plus);
        span.appendChild(minus);
        span.style.backgroundColor = '#202020';
      } else if (neg.includes(option)) {
        await set({ [negFilterKey]: neg.filter((v: string) => v !== option) });
        span.removeChild(minus);
        span.style.backgroundColor = 'white';
      } else {
        await set({ [filterKey]: [...pos, option] });
        span.appendChild(plus);
        span.style.backgroundColor = '#202020';
      }
      await set({ dirty: true });
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

const createFilterBox = (label: string, child: HTMLElement) => {
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

const configByFilter: Record<TFilterKey, TFilterConfig> = {
  prefixes: {
    label: 'Course prefix',
    initChild: () => createMultiselectList('prefixes', PREFIX_VALUES),
  },
  periods: {
    label: 'Period',
    initChild: () => createMultiselectList('periods', PERIOD_VALUES),
  },
};

// ---------------------
const init = () => {
  set({ dirty: false });
  injectPeriodElements();
  removeDefaultPeriodsFilter();

  const buttonWrapper = el('div');
  const reloadButton = el('button');

  buttonWrapper.id = 'reloadFiltersButton';
  reloadButton.textContent = 'APPLY FILTERS';
  reloadButton.addEventListener('click', () => window.location.reload());
  buttonWrapper.appendChild(reloadButton);

  if (!document.getElementById('reloadFiltersButton')) {
    document.querySelector('.filters-container')?.appendChild(buttonWrapper);
  }

  const courseListContainer = document.querySelector('.listing');

  if (courseListContainer) {
    new MutationObserver(() => {
      injectPeriodElements();
    }).observe(courseListContainer, { childList: true });
  }

  browser.storage.onChanged.addListener(changes => {
    if (changes.dirty?.newValue) {
      buttonWrapper.style.display = 'flex';
    }
    if (changes.coursesLoaded?.newValue) {
      set({ coursesLoaded: false });

      removeDefaultPeriodsFilter();
      injectPeriodElements();
    }
  });

  Promise.all(
    FILTER_KEYS.map(async key => {
      const { label, initChild } = configByFilter[key];
      return createFilterBox(label, await initChild());
    })
  ).then(async filters => {
    const mobileHeader = document.querySelector('div.filters-mobile-header');
    filters.map(async node => {
      if (!document.getElementById(node.id) && mobileHeader)
        mobileHeader.insertAdjacentElement('afterend', node);
    });
  });
};

browser.runtime.onMessage.addListener(msg => {
  if (msg === 'loadComplete') {
    init();
  }
});
