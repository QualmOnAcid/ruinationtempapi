const express = require('express');

const router = express.Router();


const fs = require('fs')
const axios = require('axios');
const {
    DateTime
} = require('luxon');

const XMPPRegions = {"as2":"as2","asia":"jp1","br1":"br1","eu":"ru1","eu3":"eu3","eun1":"eu2","euw1":"eu1","jp1":"jp1","kr1":"kr1","la1":"la1","la2":"la2","na1":"na1","oc1":"oc1","pbe1":"pb1","ru1":"ru1","sea1":"sa1","sea2":"sa2","sea3":"sa3","sea4":"sa4","tr1":"tr1","us":"la1","us-br1":"br1","us-la2":"la2","us2":"us2"};
const XMPPRegionURLs = {"as2":"as2.chat.si.riotgames.com","asia":"jp1.chat.si.riotgames.com","br1":"br.chat.si.riotgames.com","eu":"ru1.chat.si.riotgames.com","eu3":"eu3.chat.si.riotgames.com","eun1":"eun1.chat.si.riotgames.com","euw1":"euw1.chat.si.riotgames.com","jp1":"jp1.chat.si.riotgames.com","kr1":"kr1.chat.si.riotgames.com","la1":"la1.chat.si.riotgames.com","la2":"la2.chat.si.riotgames.com","na1":"na2.chat.si.riotgames.com","oc1":"oc1.chat.si.riotgames.com","pbe1":"pbe1.chat.si.riotgames.com","ru1":"ru1.chat.si.riotgames.com","sea1":"sa1.chat.si.riotgames.com","sea2":"sa2.chat.si.riotgames.com","sea3":"sa3.chat.si.riotgames.com","sea4":"sa4.chat.si.riotgames.com","tr1":"tr1.chat.si.riotgames.com","us":"la1.chat.si.riotgames.com","us-br1":"br.chat.si.riotgames.com","us-la2":"la2.chat.si.riotgames.com","us2":"us2.chat.si.riotgames.com"};

const https = require("https")
const tls = require("tls");

const fetch = (url, options={}) => {
    return new Promise((resolve) => {
        const req = https.request(url, {
            method: options.method || "GET",
            headers: options.headers || {}
        }, resp => {
            const res = {
                statusCode: resp.statusCode,
                headers: resp.headers
            };
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                res.body = data;
                resolve(res);
            });
        });
        req.write(options.body || "");
        req.end();
    });
}

async function riotGetPAS(token) {
    const res = await fetch("https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat", {
        method: "GET",
        headers: {
            "Authorization": "Bearer " + token,
        },
    });
    return res.body
}

function decodeToken(token) {
    return JSON.parse(atob(token.split('.')[1]))
}

function extractDataFromXML(xml, tagName, startIndex, endIndex) {
    const dataStartIndex = xml.indexOf(`<${tagName}>`, startIndex, endIndex);
    const dataEndIndex = xml.indexOf(`</${tagName}>`, dataStartIndex, endIndex);
    if(dataStartIndex >= 0 && dataEndIndex > dataStartIndex) {
        const data = xml.substring(dataStartIndex + tagName.length + 2, dataEndIndex)
        if(data) return data;
    }
}

function riotEstablishXMPPConnection(RSO, PAS) {

    return new Promise((resolve, reject) => {
        const region = decodeToken(PAS).affinity;
        const sub = decodeToken(PAS).sub
        const address = XMPPRegionURLs[region];
        const port = 5223;
        const XMPPRegion = XMPPRegions[region];
    
        const messages = [
            `<?xml version="1.0"?><stream:stream to="${XMPPRegion}.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, "",
            `<auth mechanism="X-Riot-RSO-PAS" xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><rso_token>${RSO}</rso_token><pas_token>${PAS}</pas_token></auth>`,
            `<?xml version="1.0"?><stream:stream to="${XMPPRegion}.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, "",
            "<iq id=\"_xmpp_bind1\" type=\"set\"><bind xmlns=\"urn:ietf:params:xml:ns:xmpp-bind\"></bind></iq>",
            "<iq id=\"_xmpp_session1\" type=\"set\"><session xmlns=\"urn:ietf:params:xml:ns:xmpp-session\"/></iq>",
            "<presence/>"
        ]
    
        const sock = tls.connect(port, address, {}, () => {
         //   console.log("connected")
            sendNext();
        });
    
        const send = data => {
            try {
                if(sock.readyState === "open") sock.write(data, "utf8", () => {
             //       if(data !== " ") console.log("-> " + data)
                });
            } catch (e) {
                err(e);
            }
        }
    
        const sendNext = () => send(messages.shift());
    
        let bufferedMessage = "";
    
        sock.on("data", data => {
            try {
                data = data.toString();
               // console.log("<- " + data);
                if(messages.length > 0) sendNext();
    
                // handle riot splitting messages into multiple parts
                if(data.startsWith("<?xml")) return;
                let oldBufferedMessage = null;
                while(oldBufferedMessage !== bufferedMessage) {
                    oldBufferedMessage = bufferedMessage;
                    data = bufferedMessage + data;
                    if(data === "") return;
                    if(!data.startsWith('<')) return err("RIOT: xml presence data doesn't start with '<'! " + data);
    
                    const firstTagName = data.substring(1, data.indexOf('>')).split(' ', 1)[0];
    
                    // check for self closing tag eg <presence />
                    if(data.search(/<[^<>]+\/>/) === 0) data = data.replace("/>", `></${firstTagName}>`);
    
                    let closingTagIndex = data.indexOf(`</${firstTagName}>`);
                    if(closingTagIndex === -1) {
                        // message is split, we need to wait for the end
                        bufferedMessage = data;
                        break;
                    }
    
                    // check for tag inside itself eg <a><a></a></a>
                    // this happens when you send a message to someone
                    let containedTags = 0;
                    let nextTagIndex = data.indexOf(`<${firstTagName}`, 1);
                    while(nextTagIndex !== -1 && nextTagIndex < closingTagIndex) {
                        containedTags++;
                        nextTagIndex = data.indexOf(`<${firstTagName}`, nextTagIndex + 1);
                    }
    
                    while(containedTags > 0) {
                        closingTagIndex = data.indexOf(`</${firstTagName}>`, closingTagIndex + 1);
                        containedTags--;
                    }
    
                    const firstTagEnd = closingTagIndex + `</${firstTagName}>`.length;
                    bufferedMessage = data.substr(firstTagEnd); // will be empty string if only one tag
                    data = data.substr(0, firstTagEnd);
    
    
                    if(firstTagName === "presence") {
                        const puuid = data.substr(16, 36);
                        if(puuid == sub) {
                            const valorantData = extractDataFromXML(data, "valorant");
                            const base64Data = extractDataFromXML(valorantData, "p");
                            try {
                                const presenceData = JSON.parse(atob(base64Data));
                                const partyTeam = presenceData.partyOwnerMatchScoreAllyTeam;
                                const partyEnemy = presenceData.partyOwnerMatchScoreEnemyTeam
                                let respJson = {
                                    team: partyTeam,
                                    enemy: partyEnemy
                                }
                                sock.destroy();
                                resolve(respJson)
                            } catch (e) {
                                
                            }
                        }
                    } 
    
                    data = "";
                }
            } catch (e) {
                
            }
        });
      });
 
}

router.get('/', (req, res) => {
    let token = req.query.token
const pas_token = req.query.pas

riotEstablishXMPPConnection(token, pas_token).then(resp => {
    res.send(resp)
})
});
module.exports = router;
