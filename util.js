var exec = require('child_process').exec;
var ps = require('ps-node')
var fs = require('fs');
var async = require('async')

var ports = require('./config.js').ports

function killallGethConstellationNode(cb){
  var cmd = 'killall -9';
  cmd += ' geth';
  cmd += ' constellation-node';
  var child = exec(cmd, function(){
    cb(null, null);
  });
  child.stderr.on('data', function(error){
    console.log('ERROR:', error);
    cb(error, null);
  });
}

function clearDirectories(result, cb){
  var cmd = 'rm -rf';
  for(var i in result.folders){
    var folder = result.folders[i];
    cmd += ' '+folder;    
  }
  var child = exec(cmd, function(){
    cb(null, result);
  });
  child.stderr.on('data', function(error){
    console.log('ERROR:', error);
    cb(error, null);
  });
}

function createDirectories(result, cb){
  var cmd = 'mkdir';
  for(var i in result.folders){
    var folder = result.folders[i];
    cmd += ' '+folder;    
  }
  var child = exec(cmd, function(){
    cb(null, result);
  });
  child.stderr.on('data', function(error){
    console.log('ERROR:', error);
    cb(error, null);
  });
}

function hex2a(hexx) {
  var hex = hexx.toString();//force conversion
  var str = '';
  for (var i = 0; i < hex.length; i += 2){
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}

// TODO: add error handler here for web3 connections so that program doesn't exit on error
function createWeb3Connection(result, cb){
  // Web3 IPC
  let host = result.web3IPCHost;
  let Web3IPC = require('web3_ipc');
  let options = {
    host: host,
    ipc: true,
    personal: true,
    admin: true,
    debug: false
  };
  let web3IPC = Web3IPC.create(options);
  result.web3IPC = web3IPC;
  // Web3 RPC
  let httpProvider = result.web3RPCProvider;
  let Web3RPC = require('web3');
  let web3RPC = new Web3RPC();
  web3RPC.setProvider(new web3RPC.providers.HttpProvider(httpProvider));
  result.web3RPC = web3RPC;
  cb(null, result);
}

function connectToPeer(result, cb){
  var enode = result.enode;
  result.web3IPC.admin.addPeer(enode, function(err, res){
    if(err){console.log('ERROR:', err);}
    cb(null, result);
  });
}

function getNewGethAccount(result, cb){
  var options = {encoding: 'utf8', timeout: 10*1000};
  var child = exec('geth --datadir Blockchain account new', options);
  child.stdout.on('data', function(data){
    if(data.indexOf('Your new account') >= 0){
      child.stdin.write('\n');
    } else if(data.indexOf('Repeat') >= 0){
      child.stdin.write('\n');
    } else if(data.indexOf('Address') == 0){
      var index = data.indexOf('{');
      var address = '0x'+data.substring(index+1, data.length-2);
      if(result.addressList == undefined){
        result.addressList = [];
      }
      result.addressList.push(address);
      cb(null, result);
    } 
  });
  child.stderr.on('data', function(error){
    if(error.indexOf('No etherbase set and no accounts found as default') < 0){
      console.log('ERROR:', error);
      cb(error, null);
    }
  });
}

function instanceAlreadyRunningMessage(processName){
  console.log('\n--- NOTE: There is an instance of '+processName+' already running.'+
    ' Please kill this instance by selecting option 5 before continuing\n')
}

function checkForRunningProcesses(cb){
  async.parallel({
    geth: function(callback){
      ps.lookup({
        command: 'geth',
        psargs: 'ef'
      }, 
      function(err, resultList){
        callback(err, resultList)
      })
    }, 
    constellation: function(callback){
      ps.lookup({
        command: 'constellation-node',
        psargs: 'ef'
      }, 
      function(err, resultList){
        callback(err, resultList)
      })
    } 
  }, function(err, result){
    if(result.geth.length > 0){
      instanceAlreadyRunningMessage('geth')
    }
    if(result.constellation.length > 0){
      instanceAlreadyRunningMessage('constellation')
    }
    cb(err, true)
  })
}

function createQuorumConfig(result, cb){
  console.log('[*] Creating genesis config...');
  var options = {encoding: 'utf8', timeout: 100*1000};
  let voterList = ''
  for(let bv of result.blockVoters){
    voterList += '"'+bv+'",'
  }
  voterList = voterList.slice(0, -1)
  let makerList = ''
  for(let bm of result.blockMakers){
    makerList += '"'+bm+'",'
  }
  makerList = makerList.slice(0, -1)
  var config = '{'
    +'"threshold": '+result.threshold+','
    +'"voters": ['
    + voterList
    +'],'
    +'"makers": ['
    + makerList
    +']'
  +'}'
  
  fs.writeFile('quorum-config.json', config, function(err, res){
    cb(err, result);
  });
}

function createGenesisBlockConfig(result, cb){
  var options = {encoding: 'utf8', timeout: 100*1000};
  var child = exec('quorum-genesis', options, function(error, stderr, stdout){
    cb(null, result);
  });
  child.stderr.on('data', function(error){
    console.log('ERROR:', error);
    cb(error, null);
  });
}

function isWeb3RPCConnectionAlive(web3RPC){
  let isAlive = false
  try{
    let accounts = web3RPC.eth.accounts
    if(accounts){
      isAlive = true
    }
  } catch(err){ } 
  return isAlive 
}

function generateNodeKey(result, cb){
  var options = {encoding: 'utf8', timeout: 10*1000};
  console.log('Generating node key')
  var child = exec('bootnode -genkey Blockchain/geth/nodekey', options)
  child.stderr.on('data', function(error){
    console.log('ERROR:', error)
  })
  setTimeout(function(){
    cb(null, result)
  }, 1000)
}

function displayCommunicationEnode(result, cb){
  if(!result){
    return cb({error: 'parameter not defined, could not get ip address'}, null)
  }
  var options = {encoding: 'utf8', timeout: 10*1000};
  var child = exec('bootnode -nodekey CommunicationNode/geth/nodekey -writeaddress', options)
  child.stdout.on('data', function(data){
    data = data.slice(0, -1)
    let enode = 'enode://'+data+'@'+result.localIpAddress+':'
      +ports.communicationNode
    console.log('\n', enode+'\n')
    result.nodePubKey = data
    result.enodeList = [enode]
    cb(null, result)
  })
  child.stderr.on('data', function(error){
    console.log('ERROR:', error)
    cb(error, null)
  })
}

function displayEnode(result, cb){
  var options = {encoding: 'utf8', timeout: 10*1000};
  var child = exec('bootnode -nodekey Blockchain/geth/nodekey -writeaddress', options)
  child.stdout.on('data', function(data){
    data = data.slice(0, -1)
    let enode = 'enode://'+data+'@'+result.localIpAddress+':'+ports.gethNode+'?raftport='+ports.raftHttp
    console.log('\nenode:', enode+'\n')
    result.nodePubKey = data
    result.enodeList = [enode]
    cb(null, result)
  })
  child.stderr.on('data', function(error){
    console.log('ERROR:', error)
    cb(error, null)
  })
}

function unlockAllAccounts(result, cb){
  console.log('[INFO] Unlocking all accounts ...');
  async.each(result.web3RPC.eth.accounts, function(account, callback){
    result.web3IPC.personal.unlockAccount(account, '', 999999, function(err, res){
      callback(err, res)
    })
  }, function(err){
    if(err){
      console.log('ERROR:', err)
    } else {
      console.log('[INFO] All accounts unlocked')
    }
    cb(null, result)
  })
}

exports.Hex2a = hex2a;
exports.ClearDirectories = clearDirectories;
exports.CreateDirectories = createDirectories;
exports.CreateWeb3Connection = createWeb3Connection;
exports.ConnectToPeer = connectToPeer;
exports.KillallGethConstellationNode = killallGethConstellationNode;
exports.GetNewGethAccount = getNewGethAccount;
exports.CheckForRunningProcesses = checkForRunningProcesses
exports.CreateQuorumConfig = createQuorumConfig
exports.CreateGenesisBlockConfig = createGenesisBlockConfig
exports.IsWeb3RPCConnectionAlive = isWeb3RPCConnectionAlive
exports.GenerateNodeKey = generateNodeKey
exports.DisplayEnode = displayEnode
exports.DisplayCommunicationEnode = displayCommunicationEnode
exports.UnlockAllAccounts = unlockAllAccounts
