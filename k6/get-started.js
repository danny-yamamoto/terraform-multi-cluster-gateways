import http from 'k6/http';
import { sleep } from 'k6';

export default function () {
  http.get('http://store.rairmn.com');
//  http.get('http://store.rairmn.com/west');
  sleep(1);
}
