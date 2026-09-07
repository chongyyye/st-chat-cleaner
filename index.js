// SillyTavern Chat Cleaner Extension v1.3
// 聊天记录瘦身净化器 - 100% 本地运行，零 API 消耗

const MODULE_NAME = 'st_chat_cleaner';

function getSTContext() {
    if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        return window.SillyTavern.getContext();
    }
    return null;
}

// 格式化字节为可读体积 (KB / MB)
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// 计算 UTF-8 字节大小
function getByteLength(str) {
    if (typeof str !== 'string') {
        try {
            str = JSON.stringify(str) || '';
        } catch (e) {
            str = '';
        }
    }
    return new Blob([str]).size;
}

// 读取当前设置
function getCleanerOptions() {
    return {
        preserveAuthorNote: $('#st_cleaner_opt_author_note').is(':checked'),
        cleanSwipes: $('#st_cleaner_opt_swipes').is(':checked'),
        cleanLwbSnap: $('#st_cleaner_opt_lwb_snap').is(':checked'),
        cleanMetadata: $('#st_cleaner_opt_metadata').is(':checked'),
        cleanExtra: $('#st_cleaner_opt_extra').is(':checked')
    };
}

// 诊断当前聊天健康状况
function analyzeCurrentChat() {
    const context = getSTContext();
    if (!context || !context.chat) {
        $('#st_cleaner_total_msgs').text('0');
        $('#st_cleaner_total_size').text('0.00 MB');
        $('#st_cleaner_mes_size').text('0.00 MB');
        $('#st_cleaner_bloat_size').text('0.00 MB');
        $('#st_cleaner_mes_pct').text('0%');
        $('#st_cleaner_bloat_pct').text('0%');
        $('#st_cleaner_note_text').text('未加载任何会话');
        return;
    }

    const chat = context.chat;
    const chatMetadata = context.chatMetadata || {};

    let totalBytes = 0;
    let mesBytes = 0;
    let swipesBytes = 0;
    let metadataBytes = 0;
    let extraBytes = 0;
    let lwbSnapBytes = 0;

    // 分析首行 chatMetadata
    if (chatMetadata) {
        const metaStr = JSON.stringify(chatMetadata);
        totalBytes += getByteLength(metaStr);

        if (chatMetadata.LWB_SNAP) {
            lwbSnapBytes += getByteLength(chatMetadata.LWB_SNAP);
        }
        if (chatMetadata.variables) {
            lwbSnapBytes += getByteLength(chatMetadata.variables);
        }
    }

    // 分析楼层消息
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg) continue;

        totalBytes += getByteLength(msg);

        // 正常纯文本
        if (msg.mes) {
            mesBytes += getByteLength(msg.mes);
        }

        // Swipes 整体占用的额外体积 (去除纯mes后，所有swipes冗余)
        if (Array.isArray(msg.swipes)) {
            swipesBytes += getByteLength(msg.swipes);
        }

        // 楼层元数据
        if (msg.metadata) {
            metadataBytes += getByteLength(msg.metadata);
        }

        // 扩展额外字段
        if (msg.extra) {
            extraBytes += getByteLength(msg.extra);
        }
        if (msg.swipe_info) {
            extraBytes += getByteLength(msg.swipe_info);
        }
    }

    // 潜在可释放垃圾：废弃/重复Swipes + 楼层元数据 + 额外字段 + 首行快照
    const bloatBytes = swipesBytes + metadataBytes + extraBytes + lwbSnapBytes;

    // 更新诊断 UI
    $('#st_cleaner_total_msgs').text(chat.length);
    $('#st_cleaner_total_size').text(formatBytes(totalBytes));
    $('#st_cleaner_mes_size').text(formatBytes(mesBytes));
    $('#st_cleaner_bloat_size').text(formatBytes(bloatBytes));

    const totalCalculated = mesBytes + bloatBytes;
    let mesPct = 50;
    let bloatPct = 50;

    if (totalCalculated > 0) {
        mesPct = Math.round((mesBytes / totalCalculated) * 100);
        bloatPct = 100 - mesPct;
    }

    $('#st_cleaner_mes_pct').text(mesPct + '%');
    $('#st_cleaner_bloat_pct').text(bloatPct + '%');
    $('#st_cleaner_bar_mes').css('width', mesPct + '%');
    $('#st_cleaner_bar_bloat').css('width', bloatPct + '%');

    // 检测作者注释
    const notePrompt = chatMetadata.note_prompt || chatMetadata.authors_note || chatMetadata.author_note || '';
    if (notePrompt && notePrompt.trim()) {
        const preview = notePrompt.trim().substring(0, 35) + (notePrompt.length > 35 ? '...' : '');
        const depth = chatMetadata.note_depth !== undefined ? ` (深度 ${chatMetadata.note_depth})` : '';
        $('#st_cleaner_note_text').html(`✅ 已检测到作者注释${depth}：<span style="opacity:0.85;">"${preview}"</span>`);
        $('#st_cleaner_note_status').show();
    } else {
        $('#st_cleaner_note_text').text('ℹ️ 当前聊天未配置作者注释 (Author\'s Note)');
    }
}

// 核心：彻底清洗当前活跃的聊天并强制持久化
async function applyCleanToActiveChat(opts) {
    const context = getSTContext();
    if (!context || !context.chat) return 0;

    const chat = context.chat;
    const chatMetadata = context.chatMetadata || {};

    const beforeBytes = getByteLength(chat) + getByteLength(chatMetadata);

    // 1. 清理首行 chatMetadata (释放 LWB_SNAP 与 variables)
    if (chatMetadata) {
        if (!opts.preserveAuthorNote) {
            delete chatMetadata.note_prompt;
            delete chatMetadata.note_interval;
            delete chatMetadata.note_position;
            delete chatMetadata.note_depth;
            delete chatMetadata.note_role;
            delete chatMetadata.authors_note;
            delete chatMetadata.author_note;
        }

        if (opts.cleanLwbSnap) {
            delete chatMetadata.LWB_SNAP;
            delete chatMetadata.variables;
            delete chatMetadata.LWB_PLOT_APPLIED_KEY;
            delete chatMetadata.LWB_PENDING_VAREVENT_BLOCKS;
            delete chatMetadata.LWB_V1_OWNED_ROOTS;
            delete chatMetadata.LWB_V1_OWNED_ROOTS_MIGRATED;
            delete chatMetadata.LWB_RULES;
        }
    }

    // 2. 清理消息数组：彻底删除冗余 swipes，不再把文本重复存两遍！
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg) continue;

        // 彻底删除 swipes 数组，直接释放整整一半体积！
        if (opts.cleanSwipes) {
            delete msg.swipes;
            delete msg.swipe_id;
            delete msg.swipe_info;
        }

        // 清理 Metadata 向量
        if (opts.cleanMetadata) {
            delete msg.metadata;
        }

        // 清理 Extra
        if (opts.cleanExtra) {
            delete msg.extra;
        }
    }

    // 3. 【双重保存】同时保存 Metadata 和 Chat 才能彻底写入硬盘！
    if (typeof context.saveMetadata === 'function') {
        await context.saveMetadata();
    }
    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }

    // 4. 重载当前聊天视图
    if (typeof context.reloadCurrentChat === 'function') {
        await context.reloadCurrentChat();
    } else if (typeof window.reloadCurrentChat === 'function') {
        await window.reloadCurrentChat();
    }

    const afterBytes = getByteLength(context.chat) + getByteLength(context.chatMetadata || {});
    return Math.max(0, beforeBytes - afterBytes);
}

// 执行模式分流
async function executeClean(mode) {
    const context = getSTContext();
    if (!context || !context.chat || context.chat.length === 0) {
        if (window.toastr) window.toastr.warning('当前没有打开任何聊天记录！');
        return;
    }

    const opts = getCleanerOptions();

    // 模式 1：自动备份并就地彻底瘦身 (最推荐、最可靠，直接干掉一半垃圾)
    if (mode === 'backup_clean') {
        try {
            if (window.toastr) window.toastr.info('正在为原始聊天创建备份检查点...', '', { timeOut: 2000 });

            if (typeof context.executeSlashCommands === 'function') {
                await context.executeSlashCommands('/checkpoint-create');
            } else if (typeof window.executeSlashCommands === 'function') {
                await window.executeSlashCommands('/checkpoint-create');
            }

            await new Promise(r => setTimeout(r, 600));

            const freed = await applyCleanToActiveChat(opts);

            const msg = `🎉 瘦身完成！已自动创建安全备份，当前聊天已释放 ${formatBytes(freed)} 空间。`;
            if (window.toastr) window.toastr.success(msg, '净化完成', { timeOut: 5000 });
            showLog(msg);

            analyzeCurrentChat();
        } catch (err) {
            console.error('备份并瘦身出错:', err);
            if (window.toastr) window.toastr.error('执行失败：' + err.message);
        }
        return;
    }

    // 模式 2：另存为新分支
    if (mode === 'branch') {
        try {
            if (window.toastr) window.toastr.info('正在创建新分支并进行净化...', '', { timeOut: 3000 });

            let switchFinished = false;
            const chatChangeHandler = () => { switchFinished = true; };
            if (context.eventSource && context.event_types) {
                context.eventSource.once(context.event_types.CHAT_CHANGED, chatChangeHandler);
            }

            if (typeof context.executeSlashCommands === 'function') {
                await context.executeSlashCommands('/branch-create');
            } else if (typeof window.executeSlashCommands === 'function') {
                await window.executeSlashCommands('/branch-create');
            }

            let waitTime = 0;
            while (!switchFinished && waitTime < 2500) {
                await new Promise(r => setTimeout(r, 200));
                waitTime += 200;
            }

            const freed = await applyCleanToActiveChat(opts);

            const msg = `🌿 新分支已创建并完成瘦身！已释放空间: ${formatBytes(freed)}，原始聊天不受影响。`;
            if (window.toastr) window.toastr.success(msg, '分支净化成功', { timeOut: 5000 });
            showLog(msg);

            analyzeCurrentChat();
        } catch (err) {
            console.error('分支创建失败:', err);
            if (window.toastr) window.toastr.error('创建分支失败：' + err.message);
        }
        return;
    }

    // 模式 3：直接就地覆盖 (不备份)
    if (mode === 'overwrite') {
        const confirmed = window.confirm('⚠️ 警告：确定直接就地瘦身当前记录吗？\n建议使用【自动备份并彻底瘦身】以防万一。');
        if (!confirmed) return;

        try {
            const freed = await applyCleanToActiveChat(opts);
            const msg = `✅ 就地瘦身完成！成功释放 ${formatBytes(freed)} 空间。`;
            if (window.toastr) window.toastr.success(msg);
            showLog(msg);
            analyzeCurrentChat();
        } catch (err) {
            if (window.toastr) window.toastr.error('清理失败：' + err.message);
        }
        return;
    }

    // 模式 4：直接下载导出文件 (.jsonl)
    if (mode === 'download') {
        try {
            const cleanedLines = [];
            const chatMetadata = context.chatMetadata || {};

            const origTotalBytes = getByteLength(context.chat) + getByteLength(chatMetadata);

            const cleanedHeader = {
                user_name: context.characterId !== undefined && context.characters && context.characters[context.characterId] ? context.characters[context.characterId].name : "User",
                character_name: "Character",
                create_date: "",
                chat_metadata: {}
            };

            if (opts.preserveAuthorNote) {
                const noteKeys = ['note_prompt', 'note_interval', 'note_position', 'note_depth', 'note_role', 'authors_note', 'author_note'];
                for (const k of Object.keys(chatMetadata)) {
                    if (noteKeys.includes(k) || k.toLowerCase().includes('author') || k.toLowerCase().includes('note')) {
                        cleanedHeader.chat_metadata[k] = chatMetadata[k];
                    }
                }
            }
            if (chatMetadata.integrity) cleanedHeader.chat_metadata.integrity = chatMetadata.integrity;

            if (!opts.cleanLwbSnap) {
                if (chatMetadata.LWB_SNAP) cleanedHeader.chat_metadata.LWB_SNAP = chatMetadata.LWB_SNAP;
                if (chatMetadata.variables) cleanedHeader.chat_metadata.variables = chatMetadata.variables;
            }

            cleanedLines.push(JSON.stringify(cleanedHeader));

            for (const origMsg of context.chat) {
                if (!origMsg) continue;
                const cleanMsg = {
                    name: origMsg.name || "",
                    is_user: !!origMsg.is_user,
                    is_system: !!origMsg.is_system,
                    send_date: origMsg.send_date || "",
                    mes: origMsg.mes || ""
                };

                // 核心：若清理 Swipes，完全不写 swipes 属性，彻底去除重复存储！
                if (!opts.cleanSwipes && Array.isArray(origMsg.swipes)) {
                    cleanMsg.swipes = origMsg.swipes;
                    cleanMsg.swipe_id = origMsg.swipe_id || 0;
                    if (origMsg.swipe_info) cleanMsg.swipe_info = origMsg.swipe_info;
                }

                if (!opts.cleanMetadata && origMsg.metadata) {
                    cleanMsg.metadata = origMsg.metadata;
                }
                if (!opts.cleanExtra && origMsg.extra) {
                    cleanMsg.extra = origMsg.extra;
                }

                cleanedLines.push(JSON.stringify(cleanMsg));
            }

            // 使用 application/octet-stream 二进制流，强行锁定文件名后缀，禁止安卓系统强加 .txt 或 .json
            const blob = new Blob([cleanedLines.join('\n')], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const rawName = (context.chatId || 'chat').replace(/\.jsonl$/i, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
            a.download = `${rawName}_cleaned.jsonl`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const freed = Math.max(0, origTotalBytes - blob.size);
            const msg = `📥 净化版文件已导出！已释放 ${formatBytes(freed)} 空间。`;
            if (window.toastr) window.toastr.success(msg);
            showLog(msg);
        } catch (err) {
            console.error('导出失败:', err);
            if (window.toastr) window.toastr.error('导出失败：' + err.message);
        }
    }
}

function showLog(text) {
    const $log = $('#st_cleaner_result_log');
    $log.text(text).fadeIn();
}

function initEventListeners() {
    $('#st_cleaner_refresh_btn').off('click').on('click', () => {
        analyzeCurrentChat();
        if (window.toastr) window.toastr.info('健康数据已更新');
    });

    $('#st_cleaner_btn_backup_clean').off('click').on('click', () => {
        executeClean('backup_clean');
    });

    $('#st_cleaner_btn_branch').off('click').on('click', () => {
        executeClean('branch');
    });

    $('#st_cleaner_btn_overwrite').off('click').on('click', () => {
        executeClean('overwrite');
    });

    $('#st_cleaner_btn_download').off('click').on('click', () => {
        executeClean('download');
    });

    $('.cleaner-checkbox-row input').off('change').on('change', () => {
        analyzeCurrentChat();
    });
}

// 扩展加载入口
jQuery(async () => {
    try {
        const context = getSTContext();
        let template = '';

        if (context && typeof context.renderExtensionTemplateAsync === 'function') {
            template = await context.renderExtensionTemplateAsync('third-party/st-chat-cleaner', 'settings');
        } else {
            const response = await fetch('/scripts/extensions/third-party/st-chat-cleaner/settings.html');
            if (response.ok) {
                template = await response.text();
            }
        }

        if (template) {
            $('#extensions_settings').append(template);
            initEventListeners();
            analyzeCurrentChat();

            if (context && context.eventSource && context.event_types) {
                context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
                    setTimeout(analyzeCurrentChat, 600);
                });
                context.eventSource.on(context.event_types.MESSAGE_RECEIVED, () => {
                    setTimeout(analyzeCurrentChat, 600);
                });
            }
        }
    } catch (err) {
        console.error('[st-chat-cleaner] 插件加载出错:', err);
    }
});
