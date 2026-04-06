import DashboardPage from './DashboardPage';
import { useLayoutContext } from '../components/Layout';

export default function DashboardWrapper() {
  const { openChat } = useLayoutContext();
  return <DashboardPage onTestAgent={(agent) => openChat(agent)} />;
}
