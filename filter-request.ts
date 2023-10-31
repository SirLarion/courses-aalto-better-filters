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

import { WebRequest, browser } from 'webextension-polyfill-ts';

const COURSES_AALTO_URL =
  'https://courses.aalto.fi/s/course/hed__Course__c/Default';

const UI_REQUEST_URL =
  'https://courses.aalto.fi/s/sfsites/aura*ui-comm-runtime-components-aura-components-siteforce-qb*';

const WEEK_IN_MILLIS = 604800000;

const COURSE_PERIOD_START_BASE: Record<
  string,
  { start: string; end: string; offset: number }
> = {
  I: { start: '08-25', end: '10-14', offset: WEEK_IN_MILLIS },
  II: { start: '10-15', end: '12-30', offset: 0 },
  III: { start: '01-01', end: '02-19', offset: WEEK_IN_MILLIS },
  IV: { start: '02-20', end: '04-14', offset: WEEK_IN_MILLIS },
  V: { start: '04-15', end: '06-05', offset: WEEK_IN_MILLIS },
  Summer: { start: '06-05', end: '08-24', offset: 0 },
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

const getCourseHasPrefix = (prefix: string, courseObj: TRawCourseObject) => {
  const code = getCourseCode(courseObj);
  return code.startsWith(prefix) || code.slice(1).startsWith(prefix);
};

const getMonthAndDate = (dateStr: string, offsetMillis?: number) => {
  let date = new Date(dateStr);
  if (offsetMillis !== undefined)
    date = new Date(date.getTime() + offsetMillis);

  const m = date.getMonth();
  const d = date.getDate();

  return String(m).padStart(2, '0') + String(d).padStart(2, '0');
};

const getInPeriod = (period: string, courseObj: TRawCourseObject) => {
  const { start, end, offset } = COURSE_PERIOD_START_BASE[period];
  const now = new Date();
  const year = now.getFullYear();

  const courseStart = getMonthAndDate(courseObj.hed__Start_Date__c);
  const courseEnd = getMonthAndDate(courseObj.hed__End_Date__c);
  const periodStart = getMonthAndDate(`${year}-${start}`);
  const periodEnd = getMonthAndDate(`${year}-${end}`);
  const periodEndOffset = getMonthAndDate(`${year}-${end}`, offset);

  return {
    starts: courseStart >= periodStart && courseStart <= periodEnd,
    ends: courseEnd >= periodStart && courseEnd <= periodEndOffset,
  };
};

const getPeriodRange = (courseObj: TRawCourseObject) => {
  let start: string | undefined = undefined;
  let end: string | undefined = undefined;
  ['I', 'II', 'III', 'IV', 'V', 'Summer'].forEach(period => {
    const { starts, ends } = getInPeriod(period, courseObj);
    if (starts && !start) start = period;
    if (ends && !end) end = period;
  });

  if (start === end) return start || '';
  return `${start}-${end}`;
};

const isValidFilterDef = (filterDef: string[]) =>
  filterDef.length > 0 && filterDef.every(filter => filter.length >= 1);

const getFilter = async (filterName: string) =>
  (await get(filterName))[filterName] || [];

//
// Modify the web request for courses to remove courses not matching
// filters
//
const filterCourses = async (courses: TRawCourseObject[]) => {
  let arr = courses;
  const posPrefixes: string[] = await getFilter('prefixes');
  const negPrefixes: string[] = await getFilter('not-prefixes');
  const posPeriods: string[] = await getFilter('periods');
  const negPeriods: string[] = await getFilter('not-periods');

  if (isValidFilterDef(posPrefixes)) {
    arr = arr.filter(course =>
      posPrefixes.find(prefix => getCourseHasPrefix(prefix, course))
    );
  }
  if (!isValidFilterDef(posPrefixes) && isValidFilterDef(negPrefixes)) {
    arr = arr.filter(
      course => !negPrefixes.find(prefix => getCourseHasPrefix(prefix, course))
    );
  }
  if (isValidFilterDef(posPeriods)) {
    arr = arr.filter(course =>
      posPeriods.find(period => getInPeriod(period, course).starts)
    );
  }
  if (!isValidFilterDef(posPeriods) && isValidFilterDef(negPeriods)) {
    arr = arr.filter(
      course => !negPeriods.find(period => getInPeriod(period, course).starts)
    );
  }

  return arr;
};

//
// Store data for which periods each fetched course belongs to. The data
// is then consumed by the content script
//
const storeCoursePeriodData = async (courses: TRawCourseObject[]) => {
  const coursePeriods: Record<string, string> = {};

  courses.forEach(course => {
    coursePeriods[getCourseCode(course)] = getPeriodRange(course);
  });

  await set({ coursePeriods });

  return courses;
};

//
// Send message to content script to call INIT
//
const sendInitMessage = () => {
  const interval = setInterval(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length > 0 && tabs[0].id !== undefined) {
        browser.tabs
          .sendMessage(tabs[0].id, 'loadComplete')
          .then(() => clearInterval(interval));
      }
    });
  }, 100);
};

const reqListener = async ({ requestId, originUrl = '' }: TDetails) => {
  if (!originUrl.startsWith(COURSES_AALTO_URL)) return { cancel: false };

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
              courses: await filterCourses(data.courses).then(
                storeCoursePeriodData
              ),
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

// Listen to a fetch that gets the SSR UI
browser.webRequest.onCompleted.addListener(sendInitMessage, {
  urls: [UI_REQUEST_URL],
});
