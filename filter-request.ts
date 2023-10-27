import { WebRequest, browser } from 'webextension-polyfill-ts';

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
    } finally {
      stream.write(encoder.encode(resStr));
      stream.close();
    }
  };
  return { cancel: false };
};

// Listen to (seemingly) the specific fetch that gets the course listing
browser.webRequest.onBeforeRequest.addListener(
  reqListener,
  {
    urls: ['https://courses.aalto.fi/s/sfsites/aura*aura.ApexAction.execute*'],
  },
  ['blocking']
);
