import { Agent } from './agent';
import { AgentSession } from './session';

const agent = new Agent();
const session = new AgentSession(agent);

session.start();

