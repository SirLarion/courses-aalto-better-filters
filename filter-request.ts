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

import { WebRequest, browser } from 'webextension-polyfill-ts';

const UI_REQUEST_URL =
  'https://courses.aalto.fi/s/sfsites/aura*ui-comm-runtime-components-aura-components-siteforce-qb*';

const COURSE_PERIOD_START_BASE: Record<string, { start: string; end: string }> =
  {
    I: { start: '08-25', end: '10-15' },
    II: { start: '10-15', end: '01-01' },
    III: { start: '01-01', end: '02-20' },
    IV: { start: '02-20', end: '04-15' },
    V: { start: '04-15', end: '05-25' },
    Summer: { start: '05-25', end: '08-25' },
  };

type TRawCourseObject = {
  hed__Course__r: {
    CourseCode__c: string;
  };
  hed__Start_Date__c: string;
  hed__End_Date__c: string;
};

type TDetails = WebRequest.OnBeforeRequestDetailsType;

const get = (key: string | string[]) => browser.storage.local.get(key);

const set = (obj: Record<string, any>) => browser.storage.local.set(obj);

const getCourseCode = (courseObj: TRawCourseObject) =>
  courseObj.hed__Course__r.CourseCode__c;

const getStartsInPeriod = (period: string, courseObj: TRawCourseObject) => {
  const { start, end } = COURSE_PERIOD_START_BASE[period];
  const now = new Date();
  const yearNow = now.getFullYear();
  const yearDelta = (() => {
    if (['I', 'II'].includes(period) && now.getMonth() < 5) {
      return -1;
    }
    if (['III', 'IV', 'V', 'Summer'].includes(period) && now.getMonth() >= 8) {
      return 1;
    }
    return 0;
  })();

  const courseStart = new Date(courseObj.hed__Start_Date__c).getTime();
  const periodStart = new Date(`${yearNow + yearDelta}-${start}`).getTime();
  const periodEnd = new Date(`${yearNow + yearDelta}-${end}`).getTime();

  return courseStart >= periodStart && courseStart < periodEnd;
};

const isValidFilterDef = (filterDef: string[]) =>
  filterDef.length > 0 && filterDef.every(filter => filter.length >= 1);

const getFilter = async (filterName: string) =>
  ((await get(filterName))[filterName] || '').split(',');

const filterCourses = async (courses: TRawCourseObject[]) => {
  let arr = courses;
  const posPrefixes: string[] = await getFilter('prefixes');
  const negPrefixes: string[] = await getFilter('not-prefixes');
  const posPeriods: string[] = await getFilter('periods');
  const negPeriods: string[] = await getFilter('not-periods');

  if (isValidFilterDef(posPrefixes)) {
    arr = arr.filter(course =>
      posPrefixes.find(prefix => getCourseCode(course)?.startsWith(prefix))
    );
  }
  if (!isValidFilterDef(posPrefixes) && isValidFilterDef(negPrefixes)) {
    arr = arr.filter(
      course =>
        !negPrefixes.find(prefix => getCourseCode(course)?.startsWith(prefix))
    );
  }
  if (isValidFilterDef(posPeriods)) {
    arr = arr.filter(course =>
      posPeriods.find(period => getStartsInPeriod(period, course))
    );
  }
  if (!isValidFilterDef(posPeriods) && isValidFilterDef(negPeriods)) {
    arr = arr.filter(
      course => !negPeriods.find(period => getStartsInPeriod(period, course))
    );
  }
  return arr;
};

const reqListener = async ({ requestId }: TDetails) => {
  const stream = browser.webRequest.filterResponseData(requestId);
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  let resStr = '';

  stream.ondata = event => {
    const str = decoder.decode(event.data, { stream: true });
    resStr += str;
  };
  stream.onstop = async () => {
    try {
      let res = JSON.parse(resStr);
      const [coursesAction, ...restActions] = res.actions;
      const data = coursesAction.returnValue.returnValue;

      if (data.courses) {
        const filteredAction = {
          ...coursesAction,
          returnValue: {
            ...coursesAction.returnValue,
            returnValue: {
              ...data,
              courses: await filterCourses(data.courses),
            },
          },
        };
        res = { ...res, actions: [filteredAction, ...restActions] };
        resStr = JSON.stringify(res);
      }
    } finally {
      stream.write(encoder.encode(resStr));
      stream.close();
      await set({ coursesLoaded: true });
    }
  };
  return { cancel: false };
};

// Listen to (seemingly) the specific fetch that gets the course data
browser.webRequest.onBeforeRequest.addListener(
  reqListener,
  {
    urls: ['https://courses.aalto.fi/s/sfsites/aura*aura.ApexAction.execute*'],
  },
  ['blocking']
);

browser.webRequest.onCompleted.addListener(
  () => {
    const interval = setInterval(() => {
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length > 0 && tabs[0].id !== undefined) {
          browser.tabs
            .sendMessage(tabs[0].id, 'loadComplete')
            .then(() => clearInterval(interval));
        }
      });
    }, 100);
  },
  {
    urls: [UI_REQUEST_URL],
  }
);
