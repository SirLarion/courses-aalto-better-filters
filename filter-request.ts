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

type TRawCourseObject = {
  hed__Course__r: {
    CourseCode__c: string;
  };
  hed__Start_Date__c: string;
  hed__End_Date__c: string;
};

type TDetails = WebRequest.OnBeforeRequestDetailsType;

const get = async (key: string | string[]) =>
  await browser.storage.local.get(key);

const getCourseCode = (courseObj: TRawCourseObject) =>
  courseObj.hed__Course__r.CourseCode__c;

const isValidPrefixes = (prefixes: string[]) =>
  prefixes.length > 0 && prefixes.every(prefix => prefix.length >= 2);

const filterCourses = async (courses: TRawCourseObject[]) => {
  let arr = courses;
  const posPrefixes: string[] = ((await get('prefixes')).prefixes || '').split(
    ','
  );
  const negPrefixes: string[] = (
    (await get('not-prefixes'))['not-prefixes'] || ''
  ).split(',');

  if (isValidPrefixes(posPrefixes)) {
    arr = arr.filter(course =>
      posPrefixes.find(prefix => getCourseCode(course)?.startsWith(prefix))
    );
  }
  if (!isValidPrefixes(posPrefixes) && isValidPrefixes(negPrefixes)) {
    arr = arr.filter(
      course =>
        !negPrefixes.find(prefix => getCourseCode(course)?.startsWith(prefix))
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
