#!/bin/bash
set -e
docker exec manage-robot-dingtalk node -e "
const { isWorkbenchManager } = require('./dist/security/workbench-manager-whitelist.js');
const { isDingtalkRoleRoutingEnabled } = require('./dist/agent/role-routing.js');
console.log('DINGTALK_ROLE_ROUTING_ENABLED=', process.env.DINGTALK_ROLE_ROUTING_ENABLED);
console.log('WORKBENCH_MANAGER_USER_IDS=', process.env.WORKBENCH_MANAGER_USER_IDS);
console.log('isDingtalkRoleRoutingEnabled=', isDingtalkRoleRoutingEnabled());
console.log('isWorkbenchManager(641871342)=', isWorkbenchManager('641871342'));
"
