// Server's guest receipt cache uses RxDB locally; Supabase remains authoritative.
import { createRxDatabase } from "https://esm.sh/rxdb@17.6.0/plugins/core";
import { getRxStorageDexie } from "https://esm.sh/rxdb@17.6.0/plugins/storage-dexie";
import { replicateRxCollection } from "https://esm.sh/rxdb@17.6.0/plugins/replication";
const schema={title:"server_guest_offline_invite",version:0,primaryKey:"id",type:"object",properties:{id:{type:"string",maxLength:64},call_id:{type:"string",maxLength:36},caller_server_id:{type:"string",maxLength:40},state:{type:"string",maxLength:16},created_at:{type:"string",maxLength:40},updated_at:{type:"string",maxLength:40},invite_expires_at:{type:"string",maxLength:40}},required:["id","call_id","caller_server_id","state","created_at","updated_at","invite_expires_at"]};
let databasePromise;
async function database(){if(!databasePromise)databasePromise=(async()=>{const db=await createRxDatabase({name:"server_guest_offline_inbox_v1",storage:getRxStorageDexie(),multiInstance:true});await db.addCollections({guest_invites:{schema}});return db;})();return databasePromise;}
export async function getGuestInvite(id){const db=await database();const doc=await db.guest_invites.findOne(id).exec();return doc?doc.toJSON():null;}
function compareCheckpoint(a,b){const delta=(Date.parse(a.updated_at)||0)-(Date.parse(b.updated_at)||0);return delta!==0?delta:String(a.id).localeCompare(String(b.id));}
// Pull-only replication. The one-time invitation token authorizes inspect but is never stored.
export async function syncGuestInvite(id,pullDocument){
 const db=await database();
 const replication=replicateRxCollection({collection:db.guest_invites,replicationIdentifier:"server-guest-invite-v1-"+id,live:false,pull:{batchSize:1,handler:async checkpoint=>{const doc=await pullDocument();if(!doc)return {documents:[],checkpoint:checkpoint||null};const next={updated_at:doc.updated_at,id:doc.id};if(checkpoint&&compareCheckpoint(next,checkpoint)<=0)return {documents:[],checkpoint};return {documents:[doc],checkpoint:next};}}});
 try{await replication.awaitInitialReplication();const doc=await db.guest_invites.findOne(id).exec();return doc?doc.toJSON():null;}finally{await replication.cancel();}
}
