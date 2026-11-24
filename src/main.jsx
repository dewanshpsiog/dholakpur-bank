import { createRoot } from 'react-dom/client';
import LiveBank from './LiveBank';
import bank from './bank-config';
import './style.css';

document.title = bank.name + ' | Account portal';
document.documentElement.dataset.bank = bank.theme;
const switchUrl = 'https://sriramtpsiog.github.io/SharedDB/';
createRoot(document.getElementById('root')).render(
  <LiveBank bank={bank} switchUrl={switchUrl} />,
);
